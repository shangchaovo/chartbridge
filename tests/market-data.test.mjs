import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCandles, fetchYahoo, searchSymbols, SYMBOL_CATALOG, MarketDataError } from '../server/market-data.mjs';

afterEach(() => mock.restoreAll());
const jsonResponse = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

test('Yahoo omits null OHLC, deduplicates timestamps, sorts bars and preserves real quote time', async () => {
  mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /chart\/600519\.SS/);
    return jsonResponse({ chart: { error: null, result: [{
      meta: { symbol: '600519.SS', currency: 'CNY', exchangeName: 'SHH', regularMarketPrice: 12,
        regularMarketTime: 1_792_000_123, regularMarketChangePercent: 2, chartPreviousClose: 8 },
      timestamp: [1_792_000_120, 1_792_000_000, 1_792_000_060, 1_792_000_120],
      indicators: { quote: [{ open: [10, 9, null, 11], high: [12, 11, 12, 13], low: [9, 8, 9, 10],
        close: [11, 10, 11, 12], volume: [1, 2, 3, 4] }] },
    }] } });
  });
  const result = await fetchYahoo('600519.SS','1d',10);
  assert.deepEqual(result.candles, [
    { timestamp: 1_792_000_000_000, open: 9, high: 11, low: 8, close: 10, volume: 2 },
    { timestamp: 1_792_000_120_000, open: 11, high: 13, low: 10, close: 12, volume: 4 },
  ]);
  assert.equal(result.meta.delayMinutes, 30);
  assert.equal(result.quote.timestamp, 1_792_000_123_000);
  assert.equal(result.quote.changePercent, 2);
  assert.equal(result.quote.previousClose, null, 'range-start previous close must not masquerade as yesterday close');
  assert.equal(result.quote.change, null);
  assert.match(result.meta.warnings.join(' '), /1 根/);
});

test('Binance requests public-only hosts, converts string OHLCV and labels rolling 24h change', async () => {
  const urls = [];
  mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    assert.equal(new URL(url).host, 'data-api.binance.vision');
    if (url.includes('/klines?')) return jsonResponse([
      [1_792_000_000_000, '10', '12', '9', '11', '5.2'],
      [1_792_014_400_000, '11', '14', '10', '13', '4.3'],
    ]);
    return jsonResponse({ lastPrice: '13.2', priceChange: '1.2', priceChangePercent: '10.0',
      prevClosePrice: '12', closeTime: 1_792_014_500_000, volume: '1234' });
  });
  const result = await fetchCandles({ symbol: 'btcusdt', interval: '4h', limit: 2 });
  assert.equal(urls.length, 2);
  assert.equal(result.candles[0].timestamp, 1_792_000_000_000);
  assert.equal(result.candles[0].volume, 5.2);
  assert.equal(result.quote.price, 13.2);
  assert.equal(result.quote.changePercent, 10);
  assert.equal(result.quote.changePeriod, 'rolling-24h');
  assert.equal(result.meta.provider, 'binance');
});

test('Unavailable quote endpoint does not replace candle data or invent a change', async () => {
  mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/ticker/')) throw new TypeError('network unavailable');
    return jsonResponse([[1_792_000_000_000, '10', '12', '9', '11', '5.2']]);
  });
  const result = await fetchCandles({ symbol: 'BTCUSDT', limit: 2 });
  assert.equal(result.candles.length, 1);
  assert.equal(result.quote.price, 11);
  assert.equal(result.quote.changePercent, null);
  assert.match(result.meta.warnings.join(' '), /报价端点不可用/);
});

test('No implicit fake bars or fallback are returned on upstream failure', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('network unavailable'); });
  await assert.rejects(fetchCandles({ symbol: 'AAPL' }), error =>
    error instanceof MarketDataError && error.code === 'UPSTREAM_UNAVAILABLE' && error.status === 502);
  assert.equal(calls, 1);
});

test('Unsupported periods and invalid inputs are rejected before network access', async () => {
  const stub = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  await assert.rejects(fetchCandles({ symbol: 'AAPL', interval: '2h' }), { code: 'INVALID_INTERVAL' });
  await assert.rejects(fetchCandles({ symbol: '../secret' }), { code: 'INVALID_SYMBOL' });
  await assert.rejects(fetchCandles({ symbol: 'AAPL', limit: 1001 }), { code: 'INVALID_LIMIT' });
  assert.equal(stub.mock.callCount(), 0);
});

test('AAPL 4h is aggregated from public Yahoo 1h bars on UTC boundaries', async () => {
  const bucket = 4 * 60 * 60 * 1000;
  const aligned = Math.floor(1_700_000_000_000 / bucket) * bucket;
  const hours = [0, 1, 2, 3, 4].map(index => aligned / 1000 + index * 3600);
  mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /interval=1h/);
    assert.doesNotMatch(url, /interval=4h/);
    return jsonResponse({ chart: { result: [{
      meta: { symbol: 'AAPL', currency: 'USD', exchangeName: 'NMS', exchangeTimezoneName: 'America/New_York', regularMarketPrice: 19, regularMarketTime: hours.at(-1) },
      timestamp: hours,
      indicators: { quote: [{ open: [10, 11, 12, 13, 14], high: [20, 21, 22, 23, 24], low: [5, 5, 5, 5, 5], close: [15, 16, 17, 18, 19], volume: [1, 1, 1, 1, 1] }] },
    }] } });
  });
  const result = await fetchCandles({ symbol: 'AAPL', interval: '4h', limit: 10 });
  assert.equal(result.interval, '4h');
  assert.equal(result.candles.length, 2);
  assert.deepEqual(result.candles[0], { timestamp: aligned, open: 10, high: 23, low: 5, close: 18, volume: 4 });
  assert.equal(result.candles[1].timestamp, aligned + bucket);
  assert.equal(result.candles[1].open, 14);
  assert.equal(result.candles[1].volume, 1);
  assert.equal(result.meta.aggregation.sourceProvider, 'yahoo');
  assert.equal(result.meta.aggregation.sourceInterval, '1h');
  assert.equal(result.meta.aggregation.timezone, 'UTC');
  assert.equal(result.meta.aggregation.alignment, 'unix-epoch-floor');
  assert.equal(result.meta.aggregation.partialBuckets, 1);
  assert.match(result.meta.warnings.join(' '), /Yahoo Finance 公开 1 小时/);
  assert.match(result.meta.warnings.join(' '), /Unix UTC/);
});

test('All-invalid upstream candles result in NO_DATA', async () => {
  mock.method(globalThis, 'fetch', async () => jsonResponse({ chart: { result: [{
    timestamp: [1_792_000_000], indicators: { quote: [{ open: [null], high: [12], low: [9], close: [11], volume: [1] }] },
  }] } }));
  await assert.rejects(fetchCandles({ symbol: 'AAPL' }), { code: 'NO_DATA', status: 404 });
});

test('Yahoo appended weekly quote is not treated as a second candle in the same week', async () => {
  mock.method(globalThis, 'fetch', async () => jsonResponse({ chart: { result: [{
    meta: { regularMarketTime: 1_792_010_168, regularMarketPrice: 12 },
    timestamp: [1_791_172_800, 1_791_777_600, 1_792_010_168],
    indicators: { quote: [{ open: [9, 10, 11], high: [11, 13, 12], low: [8, 9, 10], close: [10, 12, 12], volume: [5, 15, 3] }] },
  }] } }));
  const result = await fetchCandles({ symbol: '^GSPC', interval: '1w', limit: 10 });
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles.at(-1).volume, 15);
  assert.equal(result.quote.timestamp, 1_792_010_168_000);
  assert.match(result.meta.warnings.join(' '), /同周期报价快照/);
});

test('Search merges verified metadata, deduplicates catalog and discloses offline fallback', async () => {
  mock.method(globalThis, 'fetch', async () => jsonResponse({ quotes: [
    { symbol: 'AAPL', shortname: 'Apple', quoteType: 'EQUITY' },
    { symbol: 'XYZ.HK', longname: 'Example listed instrument', quoteType: 'EQUITY', exchDisp: 'HKSE' },
    { symbol: 'UNKNOWN', shortname: 'Unsupported quote type', quoteType: 'NONE' },
  ] }));
  const result = await searchSymbols('aapl');
  assert.equal(result.results.filter(item => item.symbol === 'AAPL').length, 1);
  assert.equal(result.results.find(item => item.symbol === 'XYZ.HK').market, 'hk');
  assert.equal(result.results.some(item => item.symbol === 'UNKNOWN'), false);
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  const offline = await searchSymbols('AAPL');
  assert.deepEqual(offline.results.map(item => item.symbol), ['AAPL', 'BINANCE:AAPLUSDT']);
  assert.match(offline.meta.warnings.join(' '), /本地品种目录/);
  assert.ok(SYMBOL_CATALOG.some(item => item.market === 'futures'));
});

test('Chinese search explains catalog coverage and avoids an unsupported remote query', async () => {
  const stub = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  const result = await searchSymbols('茅台');
  assert.deepEqual(result.results.map(item => item.symbol), ['600519.SS']);
  assert.match(result.meta.warnings.join(' '), /中文名称检索使用本地目录/);
  assert.equal(stub.mock.callCount(), 0);
});

test('Expanded directory exposes Chinese names, ETF types and every market without network access', async () => {
  const stub = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const [query, symbol] of [['长江电力','600900.SS'],['比亚迪','002594.SZ'],['半导体','SMH'],['天然气','NG=F'],['日经','^N225'],['派拓','PANW']]) {
    assert.ok((await searchSymbols(query)).results.some(item => item.symbol === symbol), query);
  }
  assert.ok(SYMBOL_CATALOG.filter(item => item.type === 'etf').length >= 30);
  assert.equal((await searchSymbols('')).results.length, SYMBOL_CATALOG.length);
  assert.equal(stub.mock.callCount(), 0);
});

test('Numeric and exchange-prefixed codes find canonical symbols even when remote search is offline', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  for (const [query, symbol] of [['600900','600900.SS'],['SZSE:002594','002594.SZ'],['sh600900','600900.SS'],['700','0700.HK'],['09988.HK','9988.HK'],['NASDAQ:PANW','PANW']]) {
    const result = await searchSymbols(query);
    assert.equal(result.results[0].symbol, symbol, query);
    assert.equal(result.results[0].direct, undefined, 'known metadata stays verified');
  }
});

test('Directory-external codes disclose unverified availability and keep exchange routing', async () => {
  const stub = mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  for (const [query, symbol, provider] of [['OKX:BTC-USDC','OKX:BTC-USDC','okx'],['KRAKEN:LINK/EUR','KRAKEN:LINK/EUR','kraken'],['BINANCE:LINKUSDC','LINKUSDC','binance']]) {
    const result = await searchSymbols(query);
    assert.equal(result.results[0].symbol, symbol);
    assert.equal(result.results[0].provider, provider);
    assert.equal(result.results[0].direct, true);
    assert.match(result.meta.warnings.join(' '), /行情源验证/);
  }
  assert.equal(stub.mock.callCount(), 0, 'exchange codes do not go through Yahoo');
  const direct = await searchSymbols('NASDAQ:ZZZZZZ');
  assert.equal(direct.results[0].symbol, 'ZZZZZZ');
  assert.equal(direct.results[0].direct, true);
  assert.deepEqual((await searchSymbols('../../secret')).results, []);
  assert.deepEqual((await searchSymbols('SINA:RB0')).results, []);
  assert.deepEqual((await searchSymbols('TQ:KQ.m@SHFE.rb')).results, []);
});
