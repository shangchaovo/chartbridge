/** Resumable public-history backfill. Writes only under gitignored data/candles. */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SYMBOL_CATALOG, fetchHistoryPage } from '../server/market-data.mjs';
import { loadPublicCatalog, catalogCounts } from '../server/public-catalog.mjs';
import { createHistoryStore } from '../server/history-store.mjs';
import { syncHistory, BACKFILL_INTERVALS } from '../server/history-sync.mjs';
import { PAGE_GAP_MS, sleep } from '../server/candle-pages.mjs';
import { iconKind } from '../src/symbol-mark.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const store = createHistoryStore(join(dataDir, 'candles', 'series'));
const statusPath = join(dataDir, 'candles', 'backfill-status.json');
const catalogPath = join(dataDir, 'public-catalog.json');
const phase = (process.argv.find(arg => arg.startsWith('--phase=')) || '--phase=higher').slice('--phase='.length);
const intervals = phase === 'all' ? [...BACKFILL_INTERVALS]
  : phase === 'lower' ? ['30m', '15m', '5m', '1m']
  : ['1d', '1w', '4h', '1h'];

await mkdir(dirname(statusPath), { recursive: true });
const loaded = await loadPublicCatalog({ base: SYMBOL_CATALOG });
const symbols = loaded.results;
await writeFile(catalogPath, JSON.stringify({ fetchedAt: new Date().toISOString(), counts: loaded.counts, errors: loaded.errors, results: symbols }));

const status = {
  startedAt: new Date().toISOString(), phase, intervals, catalog: symbols.length, counts: catalogCounts(symbols),
  icons: { image: 0, monogram: 0 },
  done: 0, skipped: 0, failed: 0, pending: symbols.length * intervals.length,
  failures: [], samples: [],
};
for (const item of symbols) status.icons[iconKind(item.symbol)] += 1;

async function save() {
  const temporary = `${statusPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(status));
  await rename(temporary, statusPath);
}

function retryable(error) {
  return [429, 418, 503].includes(error?.details?.upstreamStatus) || error?.status === 429;
}

async function fetchPage(args) {
  let wait = 1500;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { return await fetchHistoryPage(args); }
    catch (error) {
      if (!retryable(error) || attempt === 5) throw error;
      await sleep(wait);
      wait = Math.min(wait * 2, 30000);
    }
  }
  return null;
}

console.log(JSON.stringify({ catalog: symbols.length, counts: status.counts, icons: status.icons, intervals, errors: loaded.errors }));
await save();
for (const interval of intervals) {
  status.interval = interval;
  for (const item of symbols) {
    const current = await store.stat(item.symbol, interval);
    if (current.exhausted) {
      status.skipped += 1;
      status.pending = Math.max(0, status.pending - 1);
      continue;
    }
    try {
      const result = await syncHistory({
        symbol: item.symbol, interval, store, fetchPage, pause: () => sleep(PAGE_GAP_MS),
      });
      status.done += 1;
      if (status.samples.length < 12) status.samples.push({ symbol: item.symbol, interval, oldest: result.oldest, count: result.count, provider: item.provider });
      else if (item.symbol === 'ETHUSDT' || item.symbol === 'AAPL' || item.symbol.startsWith('OKX:ETH')) status.samples.push({ symbol: item.symbol, interval, oldest: result.oldest, count: result.count, provider: item.provider });
    } catch (error) {
      status.failed += 1;
      if (status.failures.length < 40) status.failures.push({ symbol: item.symbol, interval, message: String(error.message || error).slice(0, 180) });
    }
    status.pending = Math.max(0, status.pending - 1);
    status.updatedAt = new Date().toISOString();
    if ((status.done + status.failed + status.skipped) % 25 === 0) await save();
  }
  await save();
  console.log(JSON.stringify({ interval, done: status.done, skipped: status.skipped, failed: status.failed, pending: status.pending }));
}
status.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ finished: true, done: status.done, skipped: status.skipped, failed: status.failed }));
