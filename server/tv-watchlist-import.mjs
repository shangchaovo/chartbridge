import { importTradingViewConfig } from '../src/tv-import.js';

export function planWatchlistImport(found, workspace, catalog) {
  if (!found.selectedWatchlist || !found.symbols?.length) throw Object.assign(new Error('没有读到完整的 TradingView 自选清单，未使用历史片段代替。'), { status: 422 });
  const result = importTradingViewConfig(JSON.stringify({ symbols: found.symbols }), { watchlist: workspace.watchlist || [], catalog });
  const normalized = importTradingViewConfig(JSON.stringify({ symbols: found.symbols }), { catalog }).watchlist;
  const instruments = normalized.filter(symbol => !catalog.some(item => item.symbol === symbol)).map(symbol => {
    const original = found.symbols.find(value => importTradingViewConfig(JSON.stringify({ symbols: [value] }), { catalog }).watchlist[0] === symbol) || symbol;
    if (symbol.startsWith('BINANCE-SPOT:')) return { symbol, name: `${symbol.slice(13,-1)} / U`, baseAsset: symbol.slice(13,-1), market: 'crypto', provider: 'binance', exchange: 'BINANCE', currency: 'U', type: 'crypto' };
    if (symbol.startsWith('COINBASE:')) return { symbol, name: `${symbol.slice(9)} · Coinbase 现货`, market: 'crypto', provider: 'coinbase', exchange: 'COINBASE', currency: 'USD', type: 'crypto' };
    if (/^BINANCE:.*USD$/.test(symbol)) return { symbol, name: `${symbol.slice(8)} 币本位永续`, market: 'crypto', provider: 'binance-coinm', exchange: 'BINANCE', currency: 'USD', type: 'perpetual' };
    if (symbol.startsWith('PYTH:')) return { symbol, name: `${symbol.slice(5)} · PYTH 预言机（历史行情需授权）`, market: 'global', provider: 'pyth', exchange: 'PYTH', currency: 'USD', type: 'index', feedStatus: 'authorization-required' };
    if (/^BINANCE:[A-Z0-9]+(?:USDT|USDC|USD1)$/.test(symbol)) return { symbol, name: `${symbol.slice(8)} 永续`, market: 'crypto', provider: 'binance-perp', exchange: 'BINANCE', currency: symbol.match(/USDT$|USDC$|USD1$/)[0], type: 'perpetual' };
    if (/^BINANCE:/.test(original)) return { symbol, name: symbol, market: 'crypto', provider: 'binance', exchange: 'BINANCE', currency: symbol.match(/USDT$|USDC$|FDUSD$|USD1$/)?.[0] || null, type: 'crypto' };
    return { symbol, name: symbol, market: 'us', exchange: original.split(':')[0], provider: 'yahoo', currency: 'USD', type: 'stock' };
  });
  return { ...result, symbols: normalized, instruments, selectedWatchlist: found.selectedWatchlist };
}
