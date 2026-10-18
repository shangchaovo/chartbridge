import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalogCounts, loadBinancePerpetualCatalog, mergeCatalog } from './public-catalog.mjs';

export const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000;

export async function createLiveCatalog({ path, base = [], fetchImpl = fetch, clock = Date.now, refreshMs = CATALOG_REFRESH_MS } = {}) {
  let saved = {};
  try { saved = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let live = Array.isArray(saved?.results) ? saved.results : [];
  const importedPath = join(dirname(path), 'watchlist-instruments.json');
  let imported = [];
  try { const value = JSON.parse(await readFile(importedPath, 'utf8')); if (Array.isArray(value)) imported = value; } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  let source = saved?.binancePerpetuals || null;
  let pending, lastAttempt = -Infinity, error = '';
  function catalog() {
    const active = new Set(live.filter(item => item.provider === 'binance-perp').map(item => item.symbol));
    // A successful full snapshot is authoritative for listing/delisting; curated names remain useful.
    const curated = source ? base.filter(item => item.provider !== 'binance-perp' || active.has(item.symbol)) : base;
    const merged = mergeCatalog(curated, live);
    return [...merged, ...imported.filter(item => !merged.some(row => row.symbol === item.symbol))];
  }
  function meta() {
    return { provider: 'binance-exchange-info', fetchedAt: source?.fetchedAt || null, sourceUrl: source?.sourceUrl || null,
      refreshMs, stockContracts: catalog().filter(item => item.market === 'us-binance').length,
      warnings: error ? [`币安目录同步失败，正在使用已保存的目录：${error}`] : [] };
  }
  async function refresh({ force = false } = {}) {
    if (pending) return pending;
    if (!force && (source && source.schemaVersion === 3 && clock() - source.fetchedAt < refreshMs || clock() - lastAttempt < 60000)) return meta();
    lastAttempt = clock();
    pending = (async () => {
      try {
        const loaded = await loadBinancePerpetualCatalog({ fetchImpl });
        const next = [...live.filter(item => item.provider !== 'binance-perp'), ...loaded.results];
        const nextSource = { fetchedAt: clock(), sourceUrl: loaded.sourceUrl, schemaVersion: 3 };
        const nextSaved = { ...saved, results: next, counts: catalogCounts(next), binancePerpetuals: nextSource };
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(nextSaved));
        await rename(temporary, path);
        saved = nextSaved; live = next; source = nextSource; error = '';
      } catch (failure) { error = failure.message; }
      return meta();
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function addInstruments(items) {
    const map = new Map(imported.map(item => [item.symbol, item]));
    for (const item of items) map.set(item.symbol, item);
    const next = [...map.values()];
    await mkdir(dirname(importedPath), { recursive: true });
    const temporary = `${importedPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next)); await rename(temporary, importedPath); imported = next;
  }
  return { catalog, meta, refresh, addInstruments };
}
