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
  const verb = alert.direction === 'above' ? '达到或高于' : '达到或低于';
  return `价格提醒：${alert.symbol} 最新价 ${price}，已${verb} ${alert.price}`;
}

export function createPriceAlerts({ readState, updateAlerts, deliver, publish, clock = Date.now }) {
  const retryAt = new Map();
  const inflight = new Set();
  async function consider(events) {
    const state = await readState();
    const alerts = Array.isArray(state?.alerts) ? state.alerts.slice(0, 100) : [];
    if (!alerts.length) return;
    for (const event of events) {
      if (event?.type !== 'quote' || !Number.isFinite(event.quote?.price)) continue;
      for (const alert of evaluateAlerts(alerts, { symbol: event.symbol, price: event.quote.price })) {
        if (inflight.has(alert.id) || (retryAt.get(alert.id) || 0) > clock()) continue;
        inflight.add(alert.id);
        let committed = false;
        try {
          const delivery = await deliver(alert, event.quote.price);
          if (!delivery?.commit) {
            retryAt.set(alert.id, clock() + 15_000);
            continue;
          }
          const fired = { ...alert, firedAt: clock(), triggerPrice: event.quote.price, notice: delivery.notice || 'local' };
          await updateAlerts([fired]);
          committed = true;
          publish?.({
            type: 'alert',
            symbol: fired.symbol,
            alert: {
              id: fired.id, symbol: fired.symbol, direction: fired.direction, price: fired.price,
              firedAt: fired.firedAt, triggerPrice: fired.triggerPrice, notice: fired.notice,
            },
          });
        } catch {
          if (!committed) retryAt.set(alert.id, clock() + 15_000);
        } finally {
          inflight.delete(alert.id);
        }
      }
    }
  }
  return {
    onEvent(event) { if (event?.type === 'quote') void consider([event]); },
    scan(events) { return consider(events || []); },
  };
}
