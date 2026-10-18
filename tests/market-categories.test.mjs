import test from 'node:test';
import assert from 'node:assert/strict';
import { SYMBOL_CATALOG } from '../server/market-data.mjs';
import { parseBinancePerpetuals, mergeCatalog } from '../server/public-catalog.mjs';
import { matchesMarket, usStockLabel, usStockPair, mergeWatchlist } from '../src/market-categories.js';

test('stock perpetuals stay separate from broker stocks and crypto perpetuals across catalog snapshots', () => {
  const live = parseBinancePerpetuals({ symbols: ['TSLA', 'ETH'].map(baseAsset => ({
    symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING',
  })) });
  const catalog = mergeCatalog(SYMBOL_CATALOG, live);
  const binance = catalog.find(item => item.symbol === 'BINANCE:TSLAUSDT');
  const broker = catalog.find(item => item.symbol === 'TSLA');
  const crypto = catalog.find(item => item.symbol === 'BINANCE:ETHUSDT');
  assert.equal(binance.market, 'us-binance');
  for (const item of [binance, { ...binance, market: 'binance-perp' }]) {
    assert.equal(matchesMarket(item, 'us-binance'), true);
    assert.equal(matchesMarket(item, 'us'), false);
    assert.equal(matchesMarket(item, 'crypto'), false);
    assert.equal(usStockLabel(item), '币安美股 · 永续');
  }
  assert.equal(matchesMarket(broker, 'us'), true);
  assert.equal(matchesMarket(broker, 'us-binance'), false);
  assert.equal(matchesMarket(crypto, 'crypto'), true);
  assert.equal(matchesMarket(crypto, 'us-binance'), false);
  assert.equal(matchesMarket(catalog.find(item => item.symbol === 'SPY'), 'etf'), true);
  assert.equal(matchesMarket(catalog.find(item => item.symbol === 'BINANCE:SPYUSDT'), 'etf'), false);
});

test('both versions can be added from either stock category without inventing pairs', () => {
  for (const symbol of ['TSLA', 'BINANCE:TSLAUSDT', 'SPY', 'BINANCE:SPYUSDT']) {
    const item = SYMBOL_CATALOG.find(row => row.symbol === symbol);
    const pair = usStockPair(item, SYMBOL_CATALOG);
    assert.equal(pair.length, 2, symbol);
    assert.ok(pair.includes(symbol));
    const saved = mergeWatchlist(['BTCUSDT', pair[1]], pair);
    assert.deepEqual(saved.watchlist, ['BTCUSDT', pair[1], pair[0]]);
    assert.deepEqual(saved.added, [pair[0]]);
    assert.deepEqual(mergeWatchlist(saved.watchlist, pair).added, []);
    assert.deepEqual(usStockPair({ ...item, direct: true }, SYMBOL_CATALOG), []);
  }
  for (const symbol of ['BTCUSDT', 'BINANCE:ETHUSDT', 'PANW', '0700.HK']) {
    const item = SYMBOL_CATALOG.find(row => row.symbol === symbol) || { symbol, market: 'crypto', type: 'perpetual' };
    assert.deepEqual(usStockPair(item, SYMBOL_CATALOG), [], symbol);
  }
});

test('pair additions enforce the watchlist cap atomically and count only missing symbols', () => {
  const watchlist = Array.from({ length: 149 }, (_, index) => `saved-${index}`);
  const pair = ['BINANCE:TSLAUSDT', 'TSLA'];
  assert.throws(() => mergeWatchlist(watchlist, pair), /需要 2 个空位/);
  assert.equal(watchlist.length, 149);
  assert.equal(watchlist.includes(pair[0]), false);
  const oneSaved = [...watchlist.slice(0, 148), pair[0]];
  assert.equal(mergeWatchlist(oneSaved, pair).watchlist.length, 150);
  assert.equal(mergeWatchlist([...oneSaved, pair[1]], pair).watchlist.length, 150);
});

test('pairs honor underlying ticker aliases and the selected settlement asset', () => {
  const broker = { symbol: 'BRK-B', market: 'us' };
  const usdt = { symbol: 'BINANCE:BRKBUSDT', market: 'us-binance', underlyingSymbol: 'BRK-B', currency: 'USDT' };
  const usd1 = { ...usdt, symbol: 'BINANCE:BRKBUSD1', currency: 'USD1' };
  const catalog = [broker, usd1, usdt];
  assert.deepEqual(usStockPair(broker, catalog), [usdt.symbol, broker.symbol]);
  assert.deepEqual(usStockPair(usd1, catalog), [usd1.symbol, broker.symbol]);
});

test('stock tokens stay distinct while broker pair additions prefer the USDT perpetual', () => {
  const broker = { symbol: 'TSLA', market: 'us' };
  const token = { symbol: 'TSLABUSDT', type: 'stock-token', market: 'us-binance', currency: 'USDT', underlyingSymbol: 'TSLA' };
  const perp = { ...token, symbol: 'BINANCE:TSLAUSDT', type: 'perpetual' };
  assert.deepEqual(usStockPair(broker, [broker, token, perp]), [perp.symbol, broker.symbol]);
  assert.deepEqual(usStockPair(token, [broker, token, perp]), [token.symbol, broker.symbol]);
});
