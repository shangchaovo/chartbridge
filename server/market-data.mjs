/** Public, read-only feeds. No generated prices, implicit cache, account access, or orders. */
import { FUTURES_CATALOG, isDomesticFuture, fetchSinaCandles } from './public-feeds.mjs';
import { aggregateCandles, FOUR_HOURS_MS } from './aggregate-bars.mjs';
import { isOkxSymbol, isKrakenSymbol, fetchOkxCandles, fetchKrakenCandles } from './exchange-feeds.mjs';
import { isBinPerpSymbol, fetchBinPerpCandles, BIN_PERP_CATALOG } from './binance-perp.mjs';
import { EXTRA_SYMBOLS, lookupCode } from './symbol-directory.mjs';
const TIMEOUT_MS = 12_000;
const YAHOO = 'https://query1.finance.yahoo.com';
const BINANCE = 'https://data-api.binance.vision';
const YAHOO_COVERAGE = 'https://help.yahoo.com/kb/SLN2352.html';

export const SUPPORTED_INTERVALS = Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']);
const YAHOO_INTERVALS = {
  '1m': ['1m', '5d'], '5m': ['5m', '1mo'], '15m': ['15m', '1mo'],
  '30m': ['30m', '1mo'], '1h': ['1h', '2y'], '1d': ['1d', '5y'], '1w': ['1wk', '10y'],
};

const BASE_SYMBOL_CATALOG = Object.freeze([
  ['BTCUSDT', '比特币 Bitcoin / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['ETHUSDT', '以太坊 Ethereum / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['SOLUSDT', 'Solana / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['BNBUSDT', 'BNB / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['XRPUSDT', 'XRP / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['DOGEUSDT', '狗狗币 Dogecoin / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['ADAUSDT', 'Cardano / USDT', 'crypto', 'BINANCE', 'USDT', 'crypto'],
  ['AAPL', '苹果 Apple', 'us', 'NASDAQ', 'USD', 'stock'],
  ['NVDA', '英伟达 NVIDIA', 'us', 'NASDAQ', 'USD', 'stock'],
  ['MSFT', '微软 Microsoft', 'us', 'NASDAQ', 'USD', 'stock'],
  ['TSLA', '特斯拉 Tesla', 'us', 'NASDAQ', 'USD', 'stock'],
  ['AMZN', '亚马逊 Amazon', 'us', 'NASDAQ', 'USD', 'stock'],
  ['GOOGL', '谷歌 Alphabet', 'us', 'NASDAQ', 'USD', 'stock'],
  ['META', 'Meta Platforms', 'us', 'NASDAQ', 'USD', 'stock'],
  ['AMD', '超微半导体 AMD', 'us', 'NASDAQ', 'USD', 'stock'],
  ['SPY', 'SPDR 标普 500 ETF', 'us', 'NYSE ARCA', 'USD', 'etf'],
  ['QQQ', 'Invesco 纳斯达克 100 ETF', 'us', 'NASDAQ', 'USD', 'etf'],
  ['0700.HK', '腾讯控股 Tencent', 'hk', 'HKEX', 'HKD', 'stock'],
  ['9988.HK', '阿里巴巴 Alibaba', 'hk', 'HKEX', 'HKD', 'stock'],
  ['3690.HK', '美团 Meituan', 'hk', 'HKEX', 'HKD', 'stock'],
  ['1810.HK', '小米集团 Xiaomi', 'hk', 'HKEX', 'HKD', 'stock'],
  ['9618.HK', '京东集团 JD.com', 'hk', 'HKEX', 'HKD', 'stock'],
  ['0005.HK', '汇丰控股 HSBC', 'hk', 'HKEX', 'HKD', 'stock'],
  ['600519.SS', '贵州茅台 Kweichow Moutai', 'cn', 'SSE', 'CNY', 'stock'],
  ['000001.SZ', '平安银行 Ping An Bank', 'cn', 'SZSE', 'CNY', 'stock'],
  ['300750.SZ', '宁德时代 CATL', 'cn', 'SZSE', 'CNY', 'stock'],
  ['601318.SS', '中国平安 Ping An Insurance', 'cn', 'SSE', 'CNY', 'stock'],
  ['600036.SS', '招商银行 China Merchants Bank', 'cn', 'SSE', 'CNY', 'stock'],
  ['000858.SZ', '五粮液 Wuliangye', 'cn', 'SZSE', 'CNY', 'stock'],
  ['EURUSD=X', '欧元 / 美元 EUR/USD', 'forex', 'FX', 'USD', 'forex'],
  ['GBPUSD=X', '英镑 / 美元 GBP/USD', 'forex', 'FX', 'USD', 'forex'],
  ['JPY=X', '美元 / 日元 USD/JPY', 'forex', 'FX', 'JPY', 'forex'],
  ['AUDUSD=X', '澳元 / 美元 AUD/USD', 'forex', 'FX', 'USD', 'forex'],
  ['CNY=X', '美元 / 人民币 USD/CNY', 'forex', 'FX', 'CNY', 'forex'],
  ['CHF=X', '美元 / 瑞士法郎 USD/CHF', 'forex', 'FX', 'CHF', 'forex'],
  ['GC=F', 'COMEX 黄金 Gold', 'futures', 'COMEX', 'USD', 'futures'],
  ['CL=F', 'WTI 原油 Crude Oil', 'futures', 'NYMEX', 'USD', 'futures'],
  ['ES=F', '标普 500 E-mini', 'futures', 'CME', 'USD', 'futures'],
  ['NQ=F', '纳斯达克 100 E-mini', 'futures', 'CME', 'USD', 'futures'],
  ['SI=F', 'COMEX 白银 Silver', 'futures', 'COMEX', 'USD', 'futures'],
  ['HG=F', 'COMEX 铜 Copper', 'futures', 'COMEX', 'USD', 'futures'],
  ['^GSPC', '标普 500 指数 S&P 500', 'indices', 'SNP', 'USD', 'index'],
  ['^IXIC', '纳斯达克综合指数 Nasdaq', 'indices', 'NASDAQ', 'USD', 'index'],
  ['^DJI', '道琼斯工业指数 Dow Jones', 'indices', 'DJI', 'USD', 'index'],
  ['^HSI', '恒生指数 Hang Seng', 'indices', 'HKEX', 'HKD', 'index'],
  ['000001.SS', '上证综合指数 Shanghai Composite', 'indices', 'SSE', 'CNY', 'index'],
  ['399001.SZ', '深证成份指数 Shenzhen Component', 'indices', 'SZSE', 'CNY', 'index'],
].map(([symbol, name, market, exchange, currency, type]) => Object.freeze({
  symbol, name, market, exchange, currency, type, provider: market === 'crypto' ? 'binance' : 'yahoo',
})));

// OKX / Kraken 现货补充：Binance 未收录的平台币，以及以 USD 法币计价的 Kraken 现货对（与 USDT 对口径不同）。
const EXTENDED_CRYPTO_CATALOG = [
  ['OKX:OKB-USDT', 'OKB 平台币 / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:DOT-USDT', 'Polkadot / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:LTC-USDT', '莱特币 Litecoin / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:AVAX-USDT', 'Avalanche / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:LINK-USDT', 'Chainlink / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:TON-USDT', 'Toncoin / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:SUI-USDT', 'Sui / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['OKX:PEPE-USDT', 'Pepe / USDT (OKX)', 'crypto', 'OKX', 'USDT', 'crypto'],
  ['KRAKEN:BTC/USD', '比特币 Bitcoin / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:ETH/USD', '以太坊 Ethereum / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:SOL/USD', 'Solana / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:XRP/USD', 'XRP / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:ADA/USD', 'Cardano / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:DOGE/USD', '狗狗币 Dogecoin / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
  ['KRAKEN:LTC/USD', '莱特币 Litecoin / USD', 'crypto', 'KRAKEN', 'USD', 'crypto'],
].map(([symbol, name, market, exchange, currency, type]) => Object.freeze({
  symbol, name, market, exchange, currency, type, provider: exchange.toLowerCase(),
}));
export const SYMBOL_CATALOG = Object.freeze([...BASE_SYMBOL_CATALOG, ...EXTENDED_CRYPTO_CATALOG, ...BIN_PERP_CATALOG, ...EXTRA_SYMBOLS]);

export class MarketDataError extends Error {
  constructor(message, code, status = 502, details = {}) {
    super(message);
    this.name = 'MarketDataError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numberOrNull = value => finite(value) ? Number(value) : null;
const isBinanceSymbol = symbol => /^[A-Z0-9]{1,24}(?:USDT|USDC|FDUSD)$/.test(symbol);

async function fetchJson(url, provider) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 LocalChart/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new MarketDataError(`${provider} ${timeout ? '行情请求超时' : '行情网络请求失败'}。`,
      timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', timeout ? 504 : 502, { provider, sourceUrl: url });
  }
  if (!response.ok) {
    throw new MarketDataError(`${provider} 行情请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', 502,
      { provider, sourceUrl: url, upstreamStatus: response.status });
  }
  try { return await response.json(); }
  catch { throw new MarketDataError(`${provider} 返回非 JSON 响应。`, 'INVALID_UPSTREAM_RESPONSE', 502, { provider }); }
}

function normalizeCandles(rows, limit, warnings) {
  const candles = new Map();
  let invalid = 0;
  let missingVolume = false;
  for (const row of rows) {
    if (![row.timestamp, row.open, row.high, row.low, row.close].every(finite)) { invalid++; continue; }
    const candle = Object.fromEntries(['timestamp', 'open', 'high', 'low', 'close'].map(key => [key, Number(row[key])]));
    if (candle.timestamp <= 0 || candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) { invalid++; continue; }
    candle.volume = finite(row.volume) && Number(row.volume) >= 0 ? Number(row.volume) : 0;
    if(finite(row.closeTime)&&Number(row.closeTime)>=candle.timestamp){candle.closeTime=Number(row.closeTime);candle.closed=candle.closeTime<Date.now();}
    if (!finite(row.volume) || Number(row.volume) < 0) missingVolume = true;
    candles.set(candle.timestamp, candle);
  }
  if (invalid) warnings.push(`已略过 ${invalid} 根字段缺失或无效的源数据 K 线，未补造 OHLC。`);
  if (missingVolume) warnings.push('部分源数据缺少成交量，图表以 0 表示缺失成交量。');
  const result = [...candles.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  if (!result.length) throw new MarketDataError('数据源未返回有效 K 线。', 'NO_DATA', 404);
  return result;
}

function yahooDelay(meta) {
  if (/\.(SS|SZ)$/.test(meta.symbol)) return 30;
  if (/\.HK$/.test(meta.symbol) || meta.symbol === '^HSI') return 15;
  if (['CMX', 'NYM', 'COMEX', 'NYMEX'].includes(meta.exchangeName)) return 30;
  if (['CME', 'CBT', 'CBOT'].includes(meta.exchangeName)) return 10;
  if (['NMS', 'NGM', 'NCM', 'NAS', 'CCY', 'SNP', 'DJI'].includes(meta.exchangeName)) return 0;
  return null;
}

export async function fetchYahoo(symbol, interval, limit) {
  const specification = YAHOO_INTERVALS[interval];
  if (!specification) throw new MarketDataError('Yahoo 不提供原生 4 小时 K 线；请改用 1 小时或日线。',
    'UNSUPPORTED_INTERVAL', 422, { provider: 'yahoo', supportedIntervals: Object.keys(YAHOO_INTERVALS) });
  const [sourceInterval, range] = specification;
  const params = new URLSearchParams({ interval: sourceInterval, range, includePrePost: 'false' });
  const sourceUrl = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
  const payload = await fetchJson(sourceUrl, 'Yahoo Finance');
  if (payload.chart?.error) throw new MarketDataError(payload.chart.error.description || 'Yahoo 无此品种的数据。',
    'NO_DATA', 404, { provider: 'yahoo', upstreamCode: payload.chart.error.code });
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp || !result.indicators?.quote?.[0]) {
    throw new MarketDataError('Yahoo 未返回此品种的 K 线。', 'NO_DATA', 404, { provider: 'yahoo' });
  }
  const meta = result.meta || {};
  const raw = result.indicators.quote[0];
  const warnings = ['Yahoo 网页行情端点未承诺稳定开放；报价、历史数据和复权口径以数据源为准。'];
  if (interval === '1m') warnings.push('1 分钟历史仅请求最近 5 天，实际返回数量受交易时段与数据源限制。');
  if (['5m', '15m', '30m'].includes(interval)) warnings.push('日内历史仅请求最近 1 个月，可能少于所需 K 线数。');
  if (meta.instrumentType === 'CURRENCY') warnings.push('外汇成交量通常为 0，不代表全市场成交量。');
  if (meta.instrumentType === 'FUTURE') warnings.push('Yahoo 通用期货代码可能随主力/近月合约切换；不是固定交割合约的连续可交易价格。');
  const rows = result.timestamp.map((time, i) => ({
    timestamp: time * 1000, open: raw.open?.[i], high: raw.high?.[i], low: raw.low?.[i], close: raw.close?.[i], volume: raw.volume?.[i],
  }));
  // Yahoo may append a quote snapshot inside the last already-present period.
  // Keep that period's OHLCV; the separate quote remains available below.
  const periodMs = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '1w': 604_800_000 }[interval];
  const trailing = rows.at(-1);
  const preceding = rows.at(-2);
  if (periodMs && preceding && trailing.timestamp > preceding.timestamp &&
      trailing.timestamp - preceding.timestamp < periodMs &&
      Math.abs(trailing.timestamp - Number(meta.regularMarketTime) * 1000) < 60_000) {
    rows.pop();
    warnings.push('已忽略数据源附加的同周期报价快照，避免把它计作独立 K 线。');
  }
  const candles = normalizeCandles(rows, limit, warnings);
  const last = candles.at(-1);
  const price = numberOrNull(meta.regularMarketPrice) ?? last.close;
  const previousClose = numberOrNull(meta.previousClose); // chartPreviousClose belongs to the range start, not the preceding day.
  const change = numberOrNull(meta.regularMarketChange) ?? (previousClose === null ? null : price - previousClose);
  const changePercent = numberOrNull(meta.regularMarketChangePercent) ??
    (previousClose && change !== null ? change / previousClose * 100 : null);
  return {
    symbol, interval, candles,
    quote: { price, previousClose, change, changePercent, timestamp: finite(meta.regularMarketTime) ? Number(meta.regularMarketTime) * 1000 : null,
      volume: numberOrNull(meta.regularMarketVolume) },
    meta: {
      provider: 'yahoo', providerName: 'Yahoo Finance', sourceUrl, coverageUrl: YAHOO_COVERAGE,
      exchange: meta.fullExchangeName || meta.exchangeName || null, currency: meta.currency || null,
      name: meta.longName || meta.shortName || symbol, timezone: meta.exchangeTimezoneName || 'UTC',
      delayMinutes: yahooDelay({ ...meta, symbol }), feedType: 'snapshot', priceBasis: 'provider-ohlc',
      fetchedAt: Date.now(), lastCandleTime: last.timestamp, requestedLimit: limit, returnedCount: candles.length,
      warnings,
    },
  };
}

async function fetchBinance(symbol, interval, limit) {
  const sourceInterval = interval === '1w' ? '1w' : interval;
  const params = new URLSearchParams({ symbol, interval: sourceInterval, limit: String(Math.min(limit, 1000)) });
  const sourceUrl = `${BINANCE}/api/v3/klines?${params}`;
  const tickerUrl = `${BINANCE}/api/v3/ticker/24hr?${new URLSearchParams({ symbol })}`;
  const [bars, tickerResult] = await Promise.allSettled([fetchJson(sourceUrl, 'Binance'), fetchJson(tickerUrl, 'Binance')]);
  if (bars.status === 'rejected') throw bars.reason;
  const payload = bars.value;
  if (!Array.isArray(payload)) throw new MarketDataError(payload?.msg || 'Binance 未返回 K 线数组。',
    'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'binance' });
  const warnings = ['Binance 现货公共行情快照；最后一根 K 线可能仍在形成。'];
  const candles = normalizeCandles(payload.map(row => ({
    timestamp: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5],closeTime:row[6],
  })), limit, warnings);
  const ticker = tickerResult.status === 'fulfilled' && !tickerResult.value.code ? tickerResult.value : null;
  if (!ticker) warnings.push('24 小时报价端点不可用，涨跌幅留空；K 线仍来自真实行情。');
  const last = candles.at(-1);
  return {
    symbol, interval, candles,
    quote: { price: numberOrNull(ticker?.lastPrice) ?? last.close, previousClose: numberOrNull(ticker?.prevClosePrice),
      change: numberOrNull(ticker?.priceChange), changePercent: numberOrNull(ticker?.priceChangePercent),
      timestamp: numberOrNull(ticker?.closeTime), volume: numberOrNull(ticker?.volume), changePeriod: 'rolling-24h' },
    meta: {
      provider: 'binance', providerName: 'Binance Spot', sourceUrl, exchange: 'BINANCE',
      currency: symbol.match(/(?:USDT|USDC|FDUSD)$/)?.[0] || null, name: SYMBOL_CATALOG.find(item => item.symbol === symbol)?.name || symbol,
      timezone: 'UTC', delayMinutes: 0, feedType: 'snapshot', priceBasis: 'spot',
      fetchedAt: Date.now(), lastCandleTime: last.timestamp, requestedLimit: limit, returnedCount: candles.length,
      warnings,
    },
  };
}

const FOUR_HOUR_NOTE = '4 小时不是该来源的原生周期。按 Unix UTC 整 4 小时边界聚合公开 1 小时 K 线：开盘取桶内第一根，收盘取最后一根，高取最高，低取最低，成交量相加。不补造缺失小时，也不按交易所交易时段对齐。';

export async function fetchAggregated4h(symbol, limit) {
  const aShare = /^\d{6}\.(SS|SZ)$/.test(symbol);
  const source = aShare ? await fetchSinaCandles(symbol, '1h', 1023) : await fetchYahoo(symbol, '1h', 10000);
  const grouped = aggregateCandles(source.candles, FOUR_HOURS_MS);
  const partial = grouped.filter(bar => bar.sourceBars < 4).length;
  const candles = grouped.slice(-Number(limit)).map(({ timestamp, open, high, low, close, volume }) => ({ timestamp, open, high, low, close, volume }));
  if (candles.length < 2) throw new MarketDataError('公开 1 小时 K 线不足以聚合成 4 小时。', 'NO_DATA', 404, { provider: source.meta.provider });
  const last = candles.at(-1);
  const sourceName = aShare ? '新浪公开 1 小时' : 'Yahoo Finance 公开 1 小时';
  return {
    symbol, interval: '4h', candles,
    quote: source.quote,
    meta: {
      ...source.meta,
      aggregation: {
        sourceProvider: source.meta.provider,
        sourceInterval: '1h',
        bucket: '4h',
        timezone: 'UTC',
        alignment: 'unix-epoch-floor',
        sourceBars: source.candles.length,
        partialBuckets: partial,
      },
      returnedCount: candles.length,
      lastCandleTime: last.timestamp,
      warnings: [
        `${FOUR_HOUR_NOTE} 来源：${sourceName}。`,
        ...(aShare ? [] : ['Yahoo 1 小时请求区间为最近 2 年。']),
        ...(partial ? [`有 ${partial} 个 4 小时桶的源 K 线少于 4 根，只保留实际返回的小时。`] : []),
        ...(source.meta.warnings || []),
      ],
    },
  };
}

/** Return ascending OHLCV bars with millisecond timestamps; throws MarketDataError on any unavailable feed. */
export async function fetchCandles({ symbol, interval = '1d', limit = 500 } = {}) {
  symbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9.^=:_/-]{1,40}$/.test(symbol) || symbol.includes('..') || symbol.startsWith('/') || symbol.endsWith('/')) throw new MarketDataError('请输入有效的行情代码。', 'INVALID_SYMBOL', 400);
  if (!SUPPORTED_INTERVALS.includes(interval)) throw new MarketDataError('不支持此 K 线周期。', 'INVALID_INTERVAL', 400,
    { supportedIntervals: SUPPORTED_INTERVALS });
  if (!Number.isInteger(Number(limit)) || Number(limit) < 2 || Number(limit) > 1000) {
    throw new MarketDataError('K 线数量必须是 2 至 1000 的整数。', 'INVALID_LIMIT', 400);
  }
  if(isDomesticFuture(symbol))return fetchSinaCandles(symbol,interval,Number(limit));
  if(isBinPerpSymbol(symbol))return fetchBinPerpCandles({symbol,interval,limit:Number(limit)});
  if(isOkxSymbol(symbol))return fetchOkxCandles({symbol,interval,limit:Number(limit)});
  if(isKrakenSymbol(symbol))return fetchKrakenCandles({symbol,interval,limit:Number(limit)});
  if(interval==='4h'&&!isBinanceSymbol(symbol))return fetchAggregated4h(symbol,Number(limit));
  if(/^\d{6}\.(SS|SZ)$/.test(symbol)&&interval!=='1w')return fetchSinaCandles(symbol,interval,Number(limit));
  return isBinanceSymbol(symbol) ? fetchBinance(symbol, interval, Number(limit)) : fetchYahoo(symbol, interval, Number(limit));
}

function yahooSearchItem(item) {
  const symbol = item.symbol;
  const catalogItem = SYMBOL_CATALOG.find(known => known.symbol === symbol);
  if (catalogItem) return catalogItem;
  const type = { EQUITY: 'stock', ETF: 'etf', CURRENCY: 'forex', FUTURE: 'futures', CRYPTOCURRENCY: 'crypto', INDEX: 'index' }[item.quoteType];
  if (!symbol || !type) return null;
  const market = type === 'index' ? 'indices' : type === 'crypto' ? 'crypto' : type === 'forex' ? 'forex' : type === 'futures' ? 'futures' :
    /\.HK$/.test(symbol) ? 'hk' : /\.(SS|SZ)$/.test(symbol) ? 'cn' : /^[A-Z]+$/.test(symbol) ? 'us' : 'global';
  return { symbol, name: item.shortname || item.longname || symbol, market, type, provider: 'yahoo',
    exchange: item.exchDisp || item.exchange || null, currency: null };
}

/** Catalog entries are symbol metadata, never price fixtures. Remote search failures are disclosed. */
export async function searchSymbols(query = '', { includeDomestic = false } = {}) {
  const trimmed = String(query).trim().slice(0, 100);
  const catalog = includeDomestic ? [...SYMBOL_CATALOG, ...FUTURES_CATALOG] : SYMBOL_CATALOG;
  if (!trimmed) return { results: [...catalog], meta: { provider: 'catalog', warnings: [] } };
  if (!includeDomestic && /^(SINA:|TQ:)/i.test(trimmed)) return { results: [], meta: { provider: 'catalog', warnings: ['国内期货已停用，保留原有配置和研究数据。'] } };
  const normalized = trimmed.toLocaleLowerCase();
  const code = lookupCode(trimmed);
  const local = catalog.filter(item => item.symbol === code?.symbol || `${item.symbol} ${item.name} ${item.exchange}`.toLocaleLowerCase().includes(normalized))
    .sort((a,b) => Number(b.symbol === code?.symbol) - Number(a.symbol === code?.symbol));
  if (code && code.provider !== 'yahoo') {
    const known = catalog.find(item => item.symbol === code.symbol);
    return { results: known ? [known, ...local.filter(item => item !== known)] : [{...code, name:code.symbol, direct:true}],
      meta: {provider:code.provider, warnings:known ? [] : ['代码直达：是否上市及可用历史由行情源验证。']} };
  }
  const futureCode=trimmed.toUpperCase().replace(/^SINA:/,'');
  if(includeDomestic&&/^[A-Z]{1,3}\d{1,4}$/.test(futureCode)&&!local.length)return {results:[{symbol:`SINA:${futureCode}`,name:`国内期货 ${futureCode}`,market:'cn-futures',type:'futures',exchange:'SINA',currency:'CNY',provider:'sina'}],meta:{provider:'sina-code',warnings:['代码有效性由在线行情源验证。']}};
  if (/[^\x00-\x7F]/.test(trimmed)) {
    return { results: local, meta: { provider: 'catalog', warnings: ['中文名称检索使用本地目录；更多品种请使用代码或英文名称搜索。'] } };
  }
  const params = new URLSearchParams({ q: code?.symbol || trimmed, quotesCount: '50', newsCount: '0', enableFuzzyQuery: 'false' });
  const warnings = [];
  let remote = [];
  try {
    const payload = await fetchJson(`${YAHOO}/v1/finance/search?${params}`, 'Yahoo Finance');
    remote = (payload.quotes || []).map(yahooSearchItem).filter(Boolean);
  } catch (error) { warnings.push(`${error.message} 当前仅显示本地品种目录匹配结果。`); }
  const unique = new Map([...local, ...remote].map(item => [item.symbol, item]));
  if (code && !unique.has(code.symbol)) {
    unique.set(code.symbol, {...code, name:code.symbol, direct:true});
    warnings.push('代码直达：是否上市及可用历史由行情源验证。');
  }
  return { results: [...unique.values()], meta: { provider: 'catalog+yahoo', warnings } };
}
