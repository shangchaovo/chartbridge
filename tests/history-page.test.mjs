import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_BARS, canLoadOlder, historyRequest, mergeOlderBars, historyHasMore, mergeRefresh } from '../src/history-page.js';

test('history requests stay bounded per scroll and keep walking past the old total cap', () => {
  assert.equal(INITIAL_BARS, 800);
  assert.equal(canLoadOlder(Array.from({ length: 799 }, (_, i) => ({ timestamp: i }))), false);
  assert.equal(canLoadOlder(Array.from({ length: 800 }, (_, i) => ({ timestamp: i }))), true);
  assert.equal(canLoadOlder(Array.from({ length: 8000 }, (_, i) => ({ timestamp: i }))), true);
  assert.equal(canLoadOlder(Array.from({ length: 800 }, (_, i) => ({ timestamp: i })), { imported: true }), false);
  assert.equal(historyRequest({ symbol: 'BTCUSDT', interval: '1d', before: 0 }), null);
  const path = historyRequest({ symbol: 'BTCUSDT', interval: '1d', before: 1_700_000_000_000 });
  const params = new URL(path, 'http://local').searchParams;
  assert.equal(params.get('limit'), '1000');
  assert.equal(params.get('before'), '1700000000000');
  const merged = mergeOlderBars([{ timestamp: 30, close: 3 }], [{ timestamp: 10, close: 1 }, { timestamp: 30, close: 9 }], 30);
  assert.deepEqual(merged.added.map(bar => bar.timestamp), [10]);
  assert.equal(historyHasMore({ addedCount: 1, received: 1000, requested: 1000, exhausted: false }), true);
  assert.equal(historyHasMore({ addedCount: 1, received: 1000, requested: 1000, exhausted: true }), false);
  assert.equal(historyHasMore({ addedCount: 1, received: 40, requested: 1000, exhausted: false }), false);
  const refreshed = mergeRefresh(
    [{ timestamp: 10, close: 1 }, { timestamp: 20, close: 2 }, { timestamp: 30, close: 3 }],
    [{ timestamp: 20, close: 4 }, { timestamp: 30, close: 5 }],
    [{ timestamp: 30, close: 6, sourceTime: 9 }],
  );
  assert.deepEqual(refreshed.map(bar => [bar.timestamp, bar.close]), [[10, 1], [20, 4], [30, 6]]);
});
