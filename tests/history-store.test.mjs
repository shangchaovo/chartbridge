import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHistoryStore } from '../server/history-store.mjs';
import { syncHistory } from '../server/history-sync.mjs';

const bar = timestamp => ({ timestamp, open: 1, high: 1, low: 1, close: 1, volume: 1 });

test('chart reads and background history writes share a series queue and older pages retain the newest quote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shanhai-history-concurrent-'));
  try {
    const store = createHistoryStore(root, { chunkSize: 4 });
    await store.merge({ symbol:'PYTH:XAUUSD', interval:'1d', bars:[bar(100)], quote:{price:2600,timestamp:100} });
    const work = [];
    for (let i=1;i<=20;i++) {
      work.push(store.merge({ symbol:'PYTH:XAUUSD', interval:'1d', bars:[bar(100-i)], quote:{price:2500,timestamp:100-i} }));
      work.push(store.read({ symbol:'PYTH:XAUUSD', interval:'1d', limit:100 }));
    }
    await Promise.all(work);
    const result = await store.read({ symbol:'PYTH:XAUUSD', interval:'1d', limit:100 });
    assert.equal(result.count,21);assert.equal(result.candles.length,21);
    assert.deepEqual(result.quote,{price:2600,timestamp:100});
  } finally { await rm(root, { recursive:true, force:true }); }
});

test('on-disk backfill walks past fixed page ceilings and does not return the series', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shanhai-history-'));
  try {
    const store = createHistoryStore(root, { chunkSize: 4 });
    let page = 0;
    const result = await syncHistory({
      symbol: 'BTCUSDT', interval: '1d', store, pause: async () => {},
      fetchPage: async () => {
        page += 1;
        if (page <= 9) {
          const start = 1000 - page * 2;
          return { candles: [bar(start), bar(start + 1)], exhausted: false, meta: { provider: 'fixture' } };
        }
        return { candles: [bar(1)], exhausted: true, meta: { provider: 'fixture' } };
      },
    });
    assert.ok(page > 8);
    assert.equal(result.count, 19);
    assert.equal(result.exhausted, true);
    assert.equal(result.oldest, 1);
    assert.equal(result.candles, undefined);
    const newest = await store.read({ symbol: 'BTCUSDT', interval: '1d', limit: 3 });
    assert.deepEqual(newest.candles.map(item => item.timestamp), [997, 998, 999]);
    const origin = await store.read({ symbol: 'BTCUSDT', interval: '1d', before: 10, limit: 5 });
    assert.deepEqual(origin.candles.map(item => item.timestamp), [1]);
    assert.equal(origin.exhausted, true);
    let extra = 0;
    const again = await syncHistory({
      symbol: 'BTCUSDT', interval: '1d', store, pause: async () => {},
      fetchPage: async () => { extra += 1; return { candles: [bar(1)], exhausted: true }; },
    });
    assert.equal(extra, 0);
    assert.equal(again.count, 19);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
