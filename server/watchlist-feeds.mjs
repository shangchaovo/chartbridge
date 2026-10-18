import { MarketDataError } from './market-data.mjs';
import { collectPagedCandles, PAGE_GAP_MS, sleep } from './candle-pages.mjs';
import { aggregateCandles } from './aggregate-bars.mjs';
import { pythFeed } from './pyth-feed.mjs';

export const isWatchlistFeed = symbol => /^COINBASE:[A-Z0-9]{2,15}(?:USD|USDT|USDC)$/.test(symbol) ||
  /^BINANCE:[A-Z0-9]{1,16}USD$/.test(symbol) || /^PYTH:/.test(symbol);
const spans = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new MarketDataError(`行情源请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', 502, { sourceUrl: url });
  return response.json();
}

export async function fetchWatchlistCandles({ symbol, interval, limit, before }) {
  if (symbol.startsWith('PYTH:')) return pythFeed.candles({ symbol, interval, limit, before });
  const coinbase = symbol.startsWith('COINBASE:');
  const body = symbol.slice(symbol.indexOf(':') + 1);
  const pair = coinbase ? body.replace(/(USDT|USDC|USD)$/, '-$1') : `${body}_PERP`;
  const sourceSpan = coinbase ? ({ '30m': 900, '4h': 3600, '1w': 86400 })[interval] || spans[interval] : spans[interval];
  const factor = coinbase ? spans[interval] / sourceSpan : 1;
  const pageSize = coinbase ? 300 : 1500;
  const sourceUrl = coinbase ? `https://api.exchange.coinbase.com/products/${pair}/candles` : 'https://www.binance.com/dapi/v1/klines';
  const paged = await collectPagedCandles({ limit: limit * factor + (factor > 1 ? factor : 0), pageSize, before,
    pause: () => sleep(PAGE_GAP_MS), fetchPage: async ({ limit: count, endTime }) => {
      const end = endTime ?? Date.now();
      const params = coinbase ? new URLSearchParams({ granularity: String(sourceSpan),
        start: new Date(end - count * sourceSpan * 1000).toISOString(), end: new Date(end).toISOString() }) :
        new URLSearchParams({ symbol: pair, interval, limit: String(count), endTime: String(end) });
      const data = await json(`${sourceUrl}?${params}`);
      if (!Array.isArray(data)) throw new MarketDataError('行情源未返回有效 K 线。', 'INVALID_UPSTREAM_RESPONSE', 502);
      return data.map(row => coinbase ? { timestamp: Number(row[0]) * 1000, low: Number(row[1]), high: Number(row[2]),
        open: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) } :
        { timestamp: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[7]) });
    } });
  const valid = paged.rows.filter(row => ['timestamp', 'open', 'high', 'low', 'close', 'volume'].every(key => Number.isFinite(row[key])) &&
    row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close) && row.volume >= 0);
  const weekOffset = interval === '1w' && coinbase ? 3 * 86400000 : 0;
  const grouped = factor > 1 ? aggregateCandles(valid.map(row => ({ ...row, timestamp: row.timestamp + weekOffset })), spans[interval] * 1000)
    .map(row => ({ ...row, timestamp: row.timestamp - weekOffset })) : valid;
  const candles = grouped.filter(row => before == null || row.timestamp < before).slice(-limit);
  if (!candles.length) throw new MarketDataError('该来源在指定区间没有有效 K 线。', 'NO_DATA', 404);
  const warnings = factor > 1 ? ['该周期按 UTC 时间桶聚合来源的较短周期 K 线；缺失时段不补造。'] : [];
  const tickerUrl = coinbase ? `https://api.exchange.coinbase.com/products/${pair}/ticker` : `https://www.binance.com/dapi/v1/ticker/24hr?symbol=${pair}`;
  let ticker;
  try { const data = await json(tickerUrl); ticker = Array.isArray(data) ? data[0] : data; } catch { warnings.push('报价端点不可用，当前仅显示源 K 线收盘价。'); }
  if (coinbase && ticker) {
    try {
      const stats = await json(`https://api.exchange.coinbase.com/products/${pair}/stats`);
      const price = Number(ticker.price), open = Number(stats.open);
      if (Number.isFinite(price) && Number.isFinite(open) && open > 0) {
        ticker.priceChange = price - open; ticker.priceChangePercent = (price / open - 1) * 100;
      }
    } catch { warnings.push('24 小时涨跌幅端点不可用，涨跌幅留空。'); }
  }
  const last = candles.at(-1);
  const numeric = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  return { symbol, interval, candles,
    quote: { price: numeric(coinbase ? ticker?.price : ticker?.lastPrice) ?? last.close,
      change: numeric(ticker?.priceChange), changePercent: numeric(ticker?.priceChangePercent),
      timestamp: coinbase ? (Date.parse(ticker?.time) || last.timestamp) : (numeric(ticker?.closeTime) ?? last.timestamp),
      volume: numeric(coinbase ? ticker?.volume : ticker?.baseVolume), changePeriod: 'rolling-24h' },
    meta: { provider: coinbase ? 'coinbase' : 'binance-coinm', providerName: coinbase ? 'Coinbase Exchange' : 'Binance 币本位永续',
      exchange: coinbase ? 'COINBASE' : 'BINANCE', sourceUrl, currency: body.match(/USDT$|USDC$|USD$/)[0],
      name: symbol, timezone: 'UTC', feedType: 'snapshot', priceBasis: coinbase ? 'spot' : 'perpetual',
      fetchedAt: Date.now(), returnedCount: candles.length, exhausted: paged.exhausted, warnings } };
}
