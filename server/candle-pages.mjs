/** Walk a public kline API toward older bars until `limit`, a short/empty page, or a stuck cursor. */
export const PAGE_GAP_MS = 150;

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function collectPagedCandles({ limit, pageSize, before, fetchPage, pause = null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('K 线分页数量无效。');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1500) throw new TypeError('K 线单页数量无效。');
  const byTime = new Map();
  const seen = new Set();
  let endTime = Number.isFinite(before) ? before - 1 : null;
  let exhausted = false;
  let pages = 0;
  while (byTime.size < limit) {
    const cursor = endTime ?? 'latest';
    if (seen.has(cursor)) { exhausted = true; break; }
    seen.add(cursor);
    const batch = await fetchPage({ limit: pageSize, endTime });
    pages += 1;
    if (!Array.isArray(batch) || batch.length === 0) { exhausted = true; break; }
    let oldest = Infinity;
    let added = 0;
    for (const row of batch) {
      const timestamp = Number(row?.timestamp);
      if (!Number.isFinite(timestamp)) continue;
      if (timestamp < oldest) oldest = timestamp;
      if (Number.isFinite(before) && timestamp >= before) continue;
      if (!byTime.has(timestamp)) { byTime.set(timestamp, { ...row, timestamp }); added += 1; }
    }
    if (batch.length < pageSize || !Number.isFinite(oldest) || added === 0) { exhausted = true; break; }
    const next = oldest - 1;
    if (endTime !== null && next >= endTime) { exhausted = true; break; }
    endTime = next;
    if (byTime.size >= limit) break;
    if (pause) await pause();
  }
  const rows = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  return { rows, exhausted, pages };
}
