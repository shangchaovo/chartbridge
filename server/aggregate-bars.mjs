export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

// Bucket public 1h bars on Unix UTC boundaries. This is not an exchange session.
export function aggregateCandles(candles, bucketMs = FOUR_HOURS_MS) {
  if (!Number.isInteger(bucketMs) || bucketMs <= 0) throw new Error('聚合周期无效。');
  const groups = new Map();
  const ordered = [...candles].filter(bar => ['timestamp', 'open', 'high', 'low', 'close'].every(key => Number.isFinite(bar?.[key])) && bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close) && bar.low <= bar.high);
  ordered.sort((a, b) => a.timestamp - b.timestamp);
  for (const bar of ordered) {
    const timestamp = Math.floor(bar.timestamp / bucketMs) * bucketMs;
    const volume = Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : 0;
    const existing = groups.get(timestamp);
    if (!existing) {
      groups.set(timestamp, { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume, sourceBars: 1 });
      continue;
    }
    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += volume;
    existing.sourceBars += 1;
  }
  return [...groups.values()];
}
