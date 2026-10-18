/** First paint stays on the recent window. Scrolling left asks for the next bounded chunk until the source is exhausted. */
export const INITIAL_BARS = 800;
export const HISTORY_PAGE = 1000;

export function canLoadOlder(candles, { imported = false } = {}) {
  return !imported && Array.isArray(candles) && candles.length >= INITIAL_BARS;
}

export function historyRequest({ symbol, interval, before }) {
  if (!Number.isFinite(before) || before <= 0) return null;
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(HISTORY_PAGE),
    before: String(before),
  });
  return `/api/candles?${params}`;
}

export function mergeOlderBars(existing, older, before) {
  const incoming = (Array.isArray(older) ? older : []).filter(bar => Number(bar?.timestamp) < before);
  const seen = new Set((existing || []).map(bar => bar.timestamp));
  const added = incoming.filter(bar => !seen.has(bar.timestamp));
  const candles = [...added, ...(existing || [])].sort((a, b) => a.timestamp - b.timestamp);
  return { candles, added };
}

export function historyHasMore({ addedCount, received, requested, exhausted }) {
  if (exhausted) return false;
  return addedCount > 0 && received >= requested;
}

/** Keep bars older than the refreshed window when a live refresh only returns the latest page. */
export function mergeRefresh(existing, fresh, recent = []) {
  const oldestFresh = fresh?.[0]?.timestamp ?? Infinity;
  const older = (existing || []).filter(bar => bar.timestamp < oldestFresh);
  return [...new Map([...older, ...(fresh || []), ...recent].map(bar => [bar.timestamp, bar])).values()]
    .sort((a, b) => a.timestamp - b.timestamp);
}
