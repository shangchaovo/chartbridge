export const MARKET_NAMES = Object.freeze({
  crypto: '加密', 'us-binance': '币安美股', us: '券商美股', hk: '港股', cn: 'A股',
  'cn-futures': '国内期货', forex: '外汇', futures: '国际期货', indices: '指数',
  global: '其他市场', local: '本地数据',
});

export const MARKET_FILTERS = Object.freeze([
  ['all', '全部'], ['crypto', '加密'], ['cn', 'A股'], ['hk', '港股'],
  ['us-binance', '币安美股'], ['us', '券商美股'], ['etf', 'ETF'],
  ['forex', '外汇'], ['futures', '国际期货'], ['indices', '指数'],
  ['global', '其他市场'], ['local', '本地'],
]);

export function marketCategory(item) {
  // Older catalog snapshots used the provider name as the market for stock perpetuals.
  return item.market === 'binance-perp' ? 'us-binance' : item.market;
}

export function matchesMarket(item, market) {
  if (market === 'all') return true;
  if (market === 'etf') return item.type === 'etf';
  return marketCategory(item) === market || market === 'futures' && item.market === 'cn-futures';
}

export function usStockLabel(item) {
  const market = marketCategory(item);
  const region = ({ kr: '韩股', hk: '港股', cn: '中国股票', 'pre-ipo': '盘前' })[item.underlyingMarket];
  return market === 'us-binance' ? item.type === 'stock-token' ? '币安美股 · 股票代币' :
    region ? `币安股票 · ${region}永续` : '币安美股 · 永续' : market === 'us' ? '券商美股' : '';
}

export function usStockPair(item, catalog) {
  const market = marketCategory(item);
  if (!['us', 'us-binance'].includes(market) || item.direct) return [];
  const ticker = market === 'us' ? item.symbol : item.underlyingSymbol || /^BINANCE:(.+)(?:USDT|USDC|USD1)$/.exec(item.symbol)?.[1];
  if (!ticker) return [];
  const broker = catalog.find(row => row.symbol === ticker && marketCategory(row) === 'us' && !row.direct);
  const candidates = catalog.filter(row => marketCategory(row) === 'us-binance' && !row.direct &&
    (row.underlyingSymbol === ticker || row.symbol === `BINANCE:${ticker}USDT`));
  const binance = market === 'us-binance' ? candidates.find(row => row.symbol === item.symbol) :
    candidates.find(row => row.type === 'perpetual' && (row.currency === 'USDT' || row.symbol.endsWith('USDT'))) ||
    candidates.find(row => row.currency === 'USDT' || row.symbol.endsWith('USDT')) || candidates[0];
  return broker && binance ? [binance.symbol, broker.symbol] : [];
}

export function mergeWatchlist(watchlist, symbols, limit = 150) {
  const added = [...new Set(symbols)].filter(symbol => !watchlist.includes(symbol));
  if (watchlist.length + added.length > limit) {
    throw new Error(`自选最多保存 ${limit} 个品种，本次需要 ${added.length} 个空位，请先移除部分自选。`);
  }
  return { watchlist: [...watchlist, ...added], added };
}
