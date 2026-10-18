import { PAGE_GAP_MS, sleep } from './candle-pages.mjs';

/** Higher timeframes first so a 1-minute pass cannot block daily charts. */
export const BACKFILL_INTERVALS = Object.freeze(['1d', '1w', '4h', '1h', '30m', '15m', '5m', '1m']);

export function backfillJobs(symbols, intervals = BACKFILL_INTERVALS, isExhausted = () => false) {
  const jobs = [];
  for (const interval of intervals) {
    for (const item of symbols || []) {
      const symbol = typeof item === 'string' ? item : item?.symbol;
      if (!symbol) continue;
      jobs.push({
        symbol, interval, provider: typeof item === 'string' ? '' : (item.provider || ''),
        skip: Boolean(isExhausted(symbol, interval)),
      });
    }
  }
  return jobs;
}

/** Persist one public page at a time until that source has no earlier bar. The return value is a summary, not the series. */
export async function syncHistory({ symbol, interval, store, fetchPage, pause = () => sleep(PAGE_GAP_MS) }) {
  const seen = new Set();
  for (;;) {
    const current = await store.stat(symbol, interval);
    if (current.exhausted) break;
    const before = current.oldest ?? null;
    const cursor = before ?? 'latest';
    if (seen.has(cursor)) {
      await store.markExhausted(symbol, interval);
      break;
    }
    seen.add(cursor);
    let page;
    try { page = await fetchPage({ symbol, interval, before }); }
    catch (error) {
      if (before != null && (error.code === 'NO_DATA' || error.status === 404)) {
        await store.markExhausted(symbol, interval);
        break;
      }
      throw error;
    }
    const bars = (Array.isArray(page?.candles) ? page.candles : []).filter(bar => Number.isFinite(Number(bar?.timestamp))).slice().sort((a, b) => a.timestamp - b.timestamp);
    if (!bars.length) {
      await store.markExhausted(symbol, interval);
      break;
    }
    const oldest = bars[0].timestamp;
    const stuck = before != null && oldest >= before;
    await store.merge({
      symbol, interval, bars, exhausted: Boolean(page.exhausted) || stuck,
      quote: page.quote || null, feed: page.meta || null,
    });
    if (page.exhausted || stuck) break;
    await pause();
  }
  const done = await store.stat(symbol, interval);
  return { symbol, interval, oldest: done.oldest, newest: done.newest, count: done.count, exhausted: Boolean(done.exhausted) };
}
