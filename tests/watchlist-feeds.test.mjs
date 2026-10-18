import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCandles } from '../server/market-data.mjs';
import { planWatchlistImport } from '../server/tv-watchlist-import.mjs';
import { pythFeed } from '../server/pyth-feed.mjs';
afterEach(() => mock.restoreAll());

test('local import keeps stock, spot, perpetual, coin-margined and Coinbase symbols distinct and merges existing favorites', () => {
  const found = { selectedWatchlist: { name: 'STOCK' }, symbols: ['NASDAQ:TSLA', 'BINANCE:TSLABUSDT', 'BINANCE:SKHYNIXUSDT.P', 'BINANCE:LTCUSD.P', 'COINBASE:BTCUSD', 'PYTH:XAUUSD'] };
  const plan = planWatchlistImport(found, { watchlist: ['BTCUSDT', 'TSLA'] }, [{ symbol: 'TSLA' }, { symbol: 'TSLABUSDT' }, { symbol: 'BINANCE:SKHYNIXUSDT' }]);
  assert.deepEqual(plan.watchlist, ['BTCUSDT', 'TSLA', 'TSLABUSDT', 'BINANCE:SKHYNIXUSDT', 'BINANCE:LTCUSD', 'COINBASE:BTCUSD', 'PYTH:XAUUSD']);
  assert.equal(plan.instruments.find(row => row.symbol === 'COINBASE:BTCUSD').provider, 'coinbase');
  assert.equal(plan.instruments.find(row => row.symbol === 'BINANCE:LTCUSD').provider, 'binance-coinm');
  assert.equal(plan.instruments.find(row => row.symbol === 'PYTH:XAUUSD').feedStatus, 'authorization-required');
  assert.throws(() => planWatchlistImport({ symbols: ['NASDAQ:RECENT'] }, {}, []), /完整/);
});

test('Coinbase quotes retain their own venue and seconds-based candles are sorted without replacing the product', async () => {
  const urls = [];
  mock.method(globalThis, 'fetch', async url => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('/ticker') ? { price: '12', time: '2026-10-18T00:00:00Z', volume: '2' } :
      [[1792195200, 9, 13, 10, 12, 2], [1792108800, 8, 12, 9, 10, 1]]));
  });
  const value = await fetchCandles({ symbol: 'COINBASE:BTCUSD', interval: '1d', limit: 2 });
  assert.equal(value.symbol, 'COINBASE:BTCUSD');
  assert.equal(value.meta.provider, 'coinbase');
  assert.equal(value.candles[0].timestamp, 1792108800000);
  assert.ok(urls.every(url => new URL(url).hostname === 'api.exchange.coinbase.com'));
});

test('coin-margined perpetuals use dapi and preserve USD contracts rather than substituting USDT', async () => {
  mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).searchParams.get('symbol'), 'LTCUSD_PERP');
    assert.ok(new URL(url).pathname.startsWith('/dapi/'));
    return new Response(JSON.stringify(String(url).includes('/ticker/') ? [{ lastPrice: '60', closeTime: 1792195200000 }] :
      [[1792108800000, '58', '61', '57', '59', '100', 1792195199999, '10'], [1792195200000, '59', '62', '58', '60', '100', 1792281599999, '11']]));
  });
  const value = await fetchCandles({ symbol: 'BINANCE:LTCUSD', interval: '1d', limit: 2 });
  assert.equal(value.meta.provider, 'binance-coinm');
  assert.equal(value.meta.currency, 'USD');
  assert.equal(value.candles.length, 2);
});

test('PYTH remains visible but reports required data authorization instead of using another gold price', async () => {
  const feed=mock.method(pythFeed,'candles',async()=>{throw Object.assign(new Error('test: authorization required'),{code:'FEED_AUTH_REQUIRED'});});
  const stub = mock.method(globalThis, 'fetch', () => { throw Error('must not fall through'); });
  await assert.rejects(fetchCandles({ symbol: 'PYTH:XAUUSD', limit: 2 }), { code: 'FEED_AUTH_REQUIRED' });
  assert.equal(stub.mock.callCount(), 0);
  assert.equal(feed.mock.callCount(),1);
  assert.equal(feed.mock.calls[0].arguments[0].symbol,'PYTH:XAUUSD');
});
