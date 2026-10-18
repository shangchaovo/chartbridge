// Binance TradFi 永续（美股/ETF 美股标的的 24×7 合约，如 BINANCE:TSLAUSDT）公共 REST 行情。
// 走 www.binance.com 的 fapi 镜像路径（本机网络 fstream WS 不推帧、fapi 直连不可用，镜像实测可达），公开端点，无需密钥，不造数。
import { MarketDataError } from './market-data.mjs';
import { collectPagedCandles, PAGE_GAP_MS, sleep } from './candle-pages.mjs';

const REST = 'https://www.binance.com';
const KLINE_BASE = `${REST}/fapi/v1/klines`;
const TICKER_BASE = `${REST}/fapi/v1/ticker/24hr`;
const TIMEOUT_MS = 12_000;
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numberOrNull = value => finite(value) ? Number(value) : null;

export const isBinPerpSymbol = symbol => /^BINANCE:[A-Z0-9]{1,24}(?:USDT|USDC|USD1)$/.test(symbol);
export const binPerpCode = symbol => isBinPerpSymbol(symbol) ? symbol.slice(8) : null;

export async function fetchBinPerpTicker(symbol) {
  const code = binPerpCode(symbol);
  if (!code) return null;
  const payload = await fetchJson(`${TICKER_BASE}?${new URLSearchParams({ symbol: code })}`);
  if (!Array.isArray(payload) && payload?.lastPrice === undefined) return null;
  const row = Array.isArray(payload) ? null : payload;
  return {
    price: numberOrNull(row?.lastPrice), change: numberOrNull(row?.priceChange),
    changePercent: numberOrNull(row?.priceChangePercent), previousClose: numberOrNull(row?.prevClosePrice),
    open: numberOrNull(row?.openPrice), high: numberOrNull(row?.highPrice), low: numberOrNull(row?.lowPrice),
    volume: numberOrNull(row?.quoteVolume), baseVolume: numberOrNull(row?.volume),
    timestamp: finite(row?.closeTime) ? Number(row.closeTime) : null, changePeriod: 'rolling-24h',
  };
}

export async function fetchBinPerpPage({ symbol, interval, before }) {
  const code = binPerpCode(symbol);
  if (!code) throw new MarketDataError('无效的币安永续符号。', 'INVALID_SYMBOL', 400, { provider: 'binance-perp' });
  const params = new URLSearchParams({ symbol: code, interval, limit: '1500' });
  if (before != null) params.set('endTime', String(before - 1));
  const sourceUrl = `${KLINE_BASE}?${params}`;
  const bars = await fetchJson(sourceUrl);
  if (!Array.isArray(bars)) throw new MarketDataError('币安永续未返回 K 线数组。', 'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'binance-perp', sourceUrl });
  const candles = bars.map(row => ({
    timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
    volume: Number(row[5]), closeTime: Number(row[6]),
  })).filter(candle => Number.isFinite(candle.timestamp)).sort((a, b) => a.timestamp - b.timestamp);
  return { candles, exhausted: bars.length < 1500, meta: { provider: 'binance-perp', sourceUrl, exhausted: bars.length < 1500 } };
}

export async function fetchBinPerpCandles({ symbol, interval, limit, before }) {
  const code = binPerpCode(symbol);
  if (!code) throw new MarketDataError('无效的币安永续符号。', 'INVALID_SYMBOL', 400, { provider: 'binance-perp' });
  const sourceUrl = `${KLINE_BASE}?${new URLSearchParams({ symbol: code, interval, limit: String(Math.min(limit, 1500)) })}`;
  const warnings = ['币安 TradFi 永续公共 K 线；最后一根 K 线可能仍在形成。',
    ...(['XAUUSDT','XAGUSDT'].includes(code)?['这是币安 USDT 计价的贵金属永续合约，价格不等同于现货黄金/白银或 PYTH 预言机。']:[])];
  const paged = await collectPagedCandles({
    limit, pageSize: 1500, before, pause: () => sleep(PAGE_GAP_MS),
    fetchPage: async ({ limit: pageLimit, endTime }) => {
      const params = new URLSearchParams({ symbol: code, interval, limit: String(pageLimit) });
      if (endTime != null) params.set('endTime', String(endTime));
      const pageUrl = `${KLINE_BASE}?${params}`;
      const bars = await fetchJson(pageUrl);
      if (!Array.isArray(bars)) {
        throw new MarketDataError('币安永续未返回 K 线数组。', 'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'binance-perp', sourceUrl: pageUrl });
      }
      return bars.map(row => ({
        timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
        volume: Number(row[5]), closeTime: Number(row[6]),
      }));
    },
  });
  const candles = paged.rows.filter(candle => ['timestamp', 'close'].every(key => Number.isFinite(candle[key])) && ['open', 'high', 'low'].every(key => Number.isFinite(candle[key]))
    && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close));
  if (!candles.length) throw new MarketDataError('币安永续未返回有效 K 线。', 'NO_DATA', 404, { provider: 'binance-perp' });
  const ticker = await fetchBinPerpTicker(symbol).catch(() => null);
  const last = candles.at(-1);
  return {
    symbol, interval, candles,
    quote: ticker || { price: last.close, timestamp: last.closeTime, change: null, changePercent: null, volume: last.volume },
    meta: {
      provider: 'binance-perp', providerName: code==='XAUUSDT'?'Binance 黄金永续':code==='XAGUSDT'?'Binance 白银永续':'Binance TradFi 永续', sourceUrl, exchange: 'BINANCE',
      currency: code.match(/USDT$|USDC$|USD1$/)[0], name: SYMBOL_NAME.get(symbol) || symbol, timezone: 'UTC', delayMinutes: 0,
      feedType: 'snapshot', priceBasis: 'perpetual', fetchedAt: Date.now(), lastCandleTime: last.timestamp,
      requestedLimit: limit, returnedCount: candles.length, exhausted: paged.exhausted,
      warnings: [...warnings, ...(!ticker ? ['24 小时报价端点不可用，涨跌幅留空；K 线仍来自真实行情。'] : [])],
    },
  };
}

export const BIN_PERP_CATALOG = Object.freeze([
  ['BINANCE:TSLAUSDT', '特斯拉 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:AAPLUSDT', '苹果 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:NVDAUSDT', '英伟达 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:MSTRUSDT', '微策略 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:COINUSDT', 'Coinbase USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:HOODUSDT', 'Robinhood USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:CRCLUSDT', 'Circl USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:PLTRUSDT', 'Palantir USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:QQQUSDT', '纳指100ETF USDT 永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:SPYUSDT', '标普500ETF USDT 永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:INTCUSDT', '英特尔 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:AMDUSDT', 'AMD USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:METAUSDT', 'Meta USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:MSFTUSDT', '微软 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:AMZNUSDT', '亚马逊 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
  ['BINANCE:GOOGLUSDT', '谷歌 USDT 美股永续', 'binance-perp', 'BINANCE', 'USDT', 'perpetual'],
].map(([symbol, name, market, exchange, currency, type]) => Object.freeze({
  symbol, name, market: 'us-binance', exchange, currency, type, provider: 'binance-perp',
})));
const SYMBOL_NAME = new Map(BIN_PERP_CATALOG.map(item => [item.symbol, item.name]));

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 LocalChart/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new MarketDataError(`币安永续 ${timeout ? '行情请求超时' : '行情网络请求失败'}。`,
      timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', timeout ? 504 : 502, { provider: 'binance-perp', sourceUrl: url });
  }
  if (!response.ok) {
    throw new MarketDataError(`币安永续请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', 502,
      { provider: 'binance-perp', sourceUrl: url, upstreamStatus: response.status });
  }
  try { return await response.json(); }
  catch { throw new MarketDataError('币安永续返回非 JSON 响应。', 'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'binance-perp' }); }
}
