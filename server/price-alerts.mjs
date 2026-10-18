import { evaluateAlerts } from '../src/alerts.js';

export function mergeFiredAlerts(previous, next) {
  if (!next || typeof next !== 'object' || !Array.isArray(next.alerts)) return next;
  const prior = new Map((previous?.alerts || []).filter(alert => alert?.id).map(alert => [alert.id, alert]));
  next.alerts = next.alerts.map(alert => {
    const saved = prior.get(alert?.id);
    if (!saved?.firedAt || alert?.firedAt) return alert;
    return { ...alert, firedAt: saved.firedAt, triggerPrice: saved.triggerPrice, notice: saved.notice };
  });
  return next;
}

export function alertMessage(alert, price) {
  return `价格提醒：${alert.symbol} 最新价 ${price}，已达到 ${alert.price}`;
}

export function createPriceAlerts({ readState, updateAlerts, deliver, publish, clock = Date.now }) {
  const retryAt = new Map();
  const inflight = new Set();
  const lastPrice = new Map();
  const crossed = new Map();
  let tail = Promise.resolve();
  async function consider(events) {
    const moves = [];
    for (const event of events || []) {
      if (event?.type !== 'quote' || typeof event.symbol !== 'string' || !Number.isFinite(event.quote?.price)) continue;
      const previous = lastPrice.get(event.symbol);
      lastPrice.set(event.symbol, event.quote.price);
      if (Number.isFinite(previous)) moves.push({ symbol: event.symbol, previous, price: event.quote.price });
    }
    if (!moves.length && !crossed.size) return;
    const state = await readState();
    const alerts = Array.isArray(state?.alerts) ? state.alerts.slice(0, 100) : [];
    const byId = new Map(alerts.filter(alert => alert?.id).map(alert => [alert.id, alert]));
    for (const id of crossed.keys()) if (!byId.get(id) || byId.get(id).firedAt) crossed.delete(id);
    for (const move of moves) {
      for (const alert of evaluateAlerts(alerts, { symbol: move.symbol, price: move.price }, move.previous)) {
        if (!crossed.has(alert.id)) crossed.set(alert.id, move.price);
      }
    }
    for (const [id, triggerPrice] of crossed) {
      const alert = byId.get(id);
      if (!alert || alert.firedAt || alert.paused || inflight.has(id) || (retryAt.get(id) || 0) > clock()) continue;
      inflight.add(id);
      let committed = false;
      try {
        const delivery = await deliver(alert, triggerPrice);
        if (!delivery?.commit) {
          retryAt.set(id, clock() + 15_000);
          continue;
        }
        const fired = { ...alert, firedAt: clock(), triggerPrice, notice: delivery.notice || 'local' };
        await updateAlerts([fired]);
        committed = true;
        crossed.delete(id);
        publish?.({
          type: 'alert',
          symbol: fired.symbol,
          alert: {
            id: fired.id, symbol: fired.symbol, direction: fired.direction, price: fired.price,
            firedAt: fired.firedAt, triggerPrice: fired.triggerPrice, notice: fired.notice,
          },
        });
      } catch {
        if (!committed) retryAt.set(id, clock() + 15_000);
      } finally {
        inflight.delete(id);
      }
    }
  }
  function enqueue(events) {
    const run = tail.then(() => consider(events));
    tail = run.catch(() => {});
    return run;
  }
  return {
    onEvent(event) { if (event?.type === 'quote') void enqueue([event]); },
    scan(events) { return enqueue(events || []); },
  };
}
