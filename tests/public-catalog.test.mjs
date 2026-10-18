import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceSpot, parseBinancePerpetuals, parseOkxSpot, parseKrakenPairs, mergeCatalog, catalogCounts, enrichBinanceAssets } from '../server/public-catalog.mjs';
import { backfillJobs } from '../server/history-sync.mjs';
import { collectPagedCandles } from '../server/candle-pages.mjs';
import { iconKind, symbolMark } from '../src/symbol-mark.js';

test('Binance TradFi equities are discovered from metadata across settlement assets, without a ticker allowlist', () => {
  const instrument = (symbol, overrides = {}) => ({ symbol, baseAsset: symbol.replace(/USDT$|USD1$/, ''),
    status: 'TRADING', contractType: 'TRADIFI_PERPETUAL', quoteAsset: 'USDT', underlyingType: 'EQUITY', ...overrides });
  const rows = parseBinancePerpetuals({ symbols: [
    instrument('RDWUSDT'), instrument('BRKBUSDT'), instrument('SPCXUSD1', { quoteAsset: 'USD1' }),
    instrument('FUTURENEWUSDT'), instrument('DELISTEDUSDT', { status: 'BREAK' }),
    instrument('XAUUSDT', { underlyingType: 'COMMODITY' }),
    instrument('HK0700USDT', { underlyingType: 'HK_EQUITY' }),
    instrument('OPENAIUSDT', { underlyingType: 'PREMARKET' }),
    instrument('BTCUSDT', { contractType: 'PERPETUAL', underlyingType: 'COIN' }),
  ] });
  assert.deepEqual(rows.filter(row => row.market === 'us-binance').map(row => row.symbol),
    ['BINANCE:RDWUSDT', 'BINANCE:BRKBUSDT', 'BINANCE:SPCXUSD1', 'BINANCE:FUTURENEWUSDT', 'BINANCE:HK0700USDT', 'BINANCE:OPENAIUSDT']);
  assert.equal(rows.find(row => row.symbol === 'BINANCE:HK0700USDT').underlyingMarket, 'hk');
  assert.equal(rows.find(row => row.symbol === 'BINANCE:SPCXUSD1').currency, 'USD1');
  assert.equal(rows.find(row => row.symbol === 'BINANCE:BRKBUSDT').underlyingSymbol, 'BRK-B');
  assert.equal(rows.find(row => row.symbol === 'BINANCE:BTCUSDT').market, 'crypto');
  assert.equal(rows.find(row => row.symbol === 'BINANCE:XAUUSDT').market, 'futures');
  assert.equal(rows.find(row => row.symbol === 'BINANCE:XAUUSDT').underlyingType, 'COMMODITY');
  const merged = mergeCatalog([{ symbol: 'RDW', name: 'Redwire', market: 'us' }], rows);
  assert.match(merged.find(row => row.symbol === 'BINANCE:RDWUSDT').name, /Redwire/);
});

test('overseas stock contracts and verified stock tokens retain their classification', () => {
  const stock = parseBinancePerpetuals({ symbols: [{ symbol: 'SKHYNIXUSDT', baseAsset: 'SKHYNIX', quoteAsset: 'USDT',
    contractType: 'TRADIFI_PERPETUAL', underlyingType: 'KR_EQUITY', status: 'TRADING' },
    { symbol: 'TSLAUSDT', baseAsset: 'TSLA', quoteAsset: 'USDT', contractType: 'TRADIFI_PERPETUAL', underlyingType: 'EQUITY', status: 'TRADING' }] });
  const spot = parseBinanceSpot({ symbols: [{ symbol: 'TSLABUSDT', baseAsset: 'TSLAB', quoteAsset: 'USDT', status: 'TRADING' },
    { symbol: 'TAOU', baseAsset: 'TAO', quoteAsset: 'U', status: 'TRADING' }] });
  const merged = mergeCatalog([], [...stock, ...spot]);
  assert.equal(merged.find(row => row.symbol === 'BINANCE:SKHYNIXUSDT').underlyingMarket, 'kr');
  assert.equal(merged.find(row => row.symbol === 'TSLABUSDT').type, 'stock-token');
  assert.equal(merged.find(row => row.symbol === 'TSLABUSDT').underlyingSymbol, 'TSLA');
  assert.equal(merged.find(row => row.symbol === 'BINANCE-SPOT:TAOU').currency, 'U');
});

test('live parsers keep more than one product and a non-BTC symbol', () => {
  const spot = parseBinanceSpot({ symbols: [
    { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', isSpotTradingAllowed: true },
    { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT', isSpotTradingAllowed: true },
    { symbol: 'ETHBTC', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'BTC', isSpotTradingAllowed: true },
    { symbol: 'BADUSDT', status: 'BREAK', baseAsset: 'BAD', quoteAsset: 'USDT' },
  ] });
  const perps = parseBinancePerpetuals({ symbols: [
    { symbol: 'ETHUSDT', status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT', baseAsset: 'ETH' },
    { symbol: 'BTCUSDT', status: 'TRADING', contractType: 'CURRENT_QUARTER', quoteAsset: 'USDT', baseAsset: 'BTC' },
  ] });
  const okx = parseOkxSpot({ data: [
    { instId: 'ETH-USDT', instType: 'SPOT', state: 'live', baseCcy: 'ETH', quoteCcy: 'USDT' },
    { instId: 'BTC-USDT', instType: 'SPOT', state: 'suspend', baseCcy: 'BTC', quoteCcy: 'USDT' },
  ] });
  const kraken = parseKrakenPairs({ result: { XETHZUSD: { wsname: 'ETH/USD', status: 'online' }, BAD: { status: 'online' } } });
  const merged = mergeCatalog([{ symbol: 'ETHUSDT', name: '以太坊 Ethereum / USDT', provider: 'binance' }], [...spot, ...perps, ...okx, ...kraken]);
  assert.ok(merged.filter(item => item.provider === 'binance').length >= 2);
  assert.equal(merged.find(item => item.symbol === 'ETHUSDT').name, '以太坊 Ethereum / USDT');
  assert.equal(merged.find(item => item.symbol === 'BINANCE:ETHUSDT').provider, 'binance-perp');
  assert.equal(merged.find(item => item.symbol === 'OKX:ETH-USDT').provider, 'okx');
  assert.equal(merged.find(item => item.symbol === 'KRAKEN:ETH/USD').provider, 'kraken');
  assert.equal(merged.some(item => item.symbol === 'ETHBTC'), false);
  assert.ok(catalogCounts(merged).binance >= 1);
});

test('official asset metadata identifies stock tokens that have no matching listed perpetual', () => {
  const rows = parseBinanceSpot({ symbols: ['QNTB', 'STXB', 'USDEB', 'BBB', 'BNB'].map(baseAsset => ({ symbol: `${baseAsset}USDT`, baseAsset, quoteAsset: 'USDT', status: 'TRADING' })) });
  const result = enrichBinanceAssets(rows, { data: [{ assetCode: 'QNTB', assetName: 'Quantinuum (bStocks)' }, { assetCode: 'STXB', assetName: 'Seagate (bStocks)' }, { assetCode: 'USDEB', assetName: 'StablecoinX (bStocks)' }, { assetCode: 'BBB', assetName: 'Blackberry（bStocks）' }, { assetCode: 'BNB', assetName: 'BNB' }] });
  assert.equal(result.filter(row => row.type === 'stock-token').length, 4);
  assert.equal(result.find(row => row.baseAsset === 'BBB').underlyingSymbol, 'BB');
  assert.equal(result.find(row => row.baseAsset === 'BNB').market, 'crypto');
  assert.match(result.find(row => row.baseAsset === 'QNTB').name, /Quantinuum/);
  const merged = mergeCatalog([{symbol:'STX',name:'Seagate',market:'us'}],result);
  assert.match(merged.find(row=>row.symbol==='STXBUSDT').name,/股票代币/);
  assert.doesNotMatch(merged.find(row=>row.symbol==='STXBUSDT').name,/永续/);
});

test('backfill visits a non-BTC symbol with the same short-page stop, daily before 1-minute', async () => {
  const jobs = backfillJobs(
    [{ symbol: 'BTCUSDT', provider: 'binance' }, { symbol: 'ETHUSDT', provider: 'binance' }, { symbol: 'AAPL', provider: 'yahoo' }],
    ['1d', '1m'],
    (symbol, interval) => symbol === 'BTCUSDT' && interval === '1d',
  );
  assert.deepEqual(jobs.map(job => `${job.symbol}:${job.interval}:${job.skip}`), [
    'BTCUSDT:1d:true', 'ETHUSDT:1d:false', 'AAPL:1d:false',
    'BTCUSDT:1m:false', 'ETHUSDT:1m:false', 'AAPL:1m:false',
  ]);
  let page = 0;
  const result = await collectPagedCandles({
    limit: 5000, pageSize: 2,
    fetchPage: async () => {
      page += 1;
      if (page <= 9) {
        const base = 5000 - page * 2;
        return [{ timestamp: base, close: 1 }, { timestamp: base + 1, close: 1 }];
      }
      return [{ timestamp: 1, close: 1 }];
    },
  });
  assert.ok(result.pages > 8);
  assert.equal(result.exhausted, true);
  assert.equal(result.rows[0].timestamp, 1);
  assert.equal(iconKind('NOT-A-REAL-TICKER'), 'monogram');
  assert.match(symbolMark('ETHUSDT'), /<svg\b|<img\b/);
  assert.doesNotMatch(symbolMark('NOT-A-REAL-TICKER'), /https?:/);
});
