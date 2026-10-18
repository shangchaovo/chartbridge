import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveCatalog } from '../server/live-catalog.mjs';
import { createMarketScope } from '../server/market-scope.mjs';

const instrument = baseAsset => ({ symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT',
  contractType: 'TRADIFI_PERPETUAL', underlyingType: 'EQUITY', status: 'TRADING' });
const response = symbols => new Response(JSON.stringify({ symbols }));
async function workspace(context) {
  const prefix = join(tmpdir(), 'shanhai-catalog-');
  const dir = await mkdtemp(prefix);
  context.after(async () => { assert.ok(dir.startsWith(prefix)); await rm(dir, { recursive: true, force: true }); });
  return join(dir, 'catalog.json');
}

test('live catalog refresh is shared, persisted and reusable offline without refreshing fresh snapshots', async context => {
  const path = await workspace(context);
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([instrument('RDW'), instrument('PANW')]); };
  const catalog = await createLiveCatalog({ path, clock: () => 1000, fetchImpl });
  await Promise.all([catalog.refresh(), catalog.refresh(), catalog.refresh()]);
  assert.equal(calls, 1);
  assert.equal(catalog.meta().stockContracts, 2);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).binancePerpetuals.fetchedAt, 1000);
  const offline = await createLiveCatalog({ path, clock: () => 1001, fetchImpl: () => { throw Error('offline'); } });
  await offline.refresh();
  assert.equal(offline.meta().stockContracts, 2);
  assert.deepEqual(offline.meta().warnings, []);
});

test('refresh failure preserves last valid snapshot and later refresh adds listings and removes delistings', async context => {
  const path = await workspace(context);
  let now = 1000, mode = 'initial';
  const catalog = await createLiveCatalog({ path, refreshMs: 100, clock: () => now,
    fetchImpl: async () => {
      if (mode === 'offline') throw Error('offline');
      if (mode === 'empty') return response([]);
      return response(mode === 'initial' ? [instrument('OLD')] : [instrument('NEW')]);
    }, base: [{ symbol: 'BINANCE:OLDUSDT', name: 'Original', provider: 'binance-perp', market: 'us-binance' }] });
  await catalog.refresh();
  const valid = await readFile(path, 'utf8');
  for (const failure of ['offline', 'empty']) {
    now += 101; mode = failure; await catalog.refresh({ force: true });
    assert.equal(catalog.catalog()[0].symbol, 'BINANCE:OLDUSDT');
    assert.equal(await readFile(path, 'utf8'), valid);
    assert.equal(catalog.meta().warnings.length, 1);
  }
  mode = 'new'; now += 101; await catalog.refresh({ force: true });
  assert.deepEqual(catalog.catalog().map(row => row.symbol), ['BINANCE:NEWUSDT']);
  assert.deepEqual(catalog.meta().warnings, []);
});

test('the live directory feeds both market browsing and namespace-preserving search', async context => {
  const path = await workspace(context);
  const catalog = await createLiveCatalog({ path, fetchImpl: async () => response([instrument('RDW')]) });
  await catalog.refresh();
  const scope = createMarketScope({ publicCatalog: catalog.catalog });
  assert.deepEqual((await scope.search('')).results, scope.catalog());
  for (const query of ['BINANCE:RDWUSDT', 'binance:rdwusdt', 'RDWUSDT']) {
    const result = await scope.search(query);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].symbol, 'BINANCE:RDWUSDT');
    assert.equal(result.results[0].market, 'us-binance');
  }
});

test('cached legacy entries and other exchange rows survive the first Binance refresh', async context => {
  const path = await workspace(context);
  const okx = { symbol: 'OKX:ETH-USDT', provider: 'okx', market: 'crypto' };
  await writeFile(path, JSON.stringify({ results: [okx, { symbol: 'BINANCE:OLDUSDT', provider: 'binance-perp' }] }));
  let calls = 0;
  const catalog = await createLiveCatalog({ path, fetchImpl: async url => {
    calls++;
    if (url.startsWith('https://www.binance.com')) return new Response('', { status: 503 });
    return response([instrument('RDW')]);
  } });
  await catalog.refresh();
  assert.equal(calls, 2);
  assert.ok(catalog.catalog().some(row => row.symbol === okx.symbol));
  assert.equal(catalog.catalog().some(row => row.symbol === 'BINANCE:OLDUSDT'), false);
  assert.equal(catalog.meta().sourceUrl, 'https://fapi.binance.com/fapi/v1/exchangeInfo');
});
