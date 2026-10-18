import { SYMBOL_CATALOG, searchSymbols } from './market-data.mjs';
import { FUTURES_CATALOG } from './public-feeds.mjs';

// Retain the optional adapter and saved work; keep it outside the active market scope.
export function createMarketScope({ domesticFutures = false, accounts = null, publicCatalog = () => SYMBOL_CATALOG } = {}) {
  const features = Object.freeze({ domesticFutures, agentResearch: true });
  function assertSymbol(symbol) {
    if (!domesticFutures && /^(?:SINA:|TQ:)/i.test(symbol)) {
      throw Object.assign(new Error('国内期货已停用，原有配置和研究数据仍保留。请选择其他市场。'), { status: 422, code: 'MARKET_DISABLED' });
    }
  }
  return {
    features, assertSymbol,
    catalog: () => [...publicCatalog(), ...(domesticFutures ? [...FUTURES_CATALOG, ...(accounts?.catalog() || [])] : [])],
    async search(query = '') {
      if (!domesticFutures && /^(?:SINA:|TQ:)/i.test(query.trim())) return searchSymbols(query);
      const own = domesticFutures ? (accounts?.catalog() || []).filter(v => `${v.symbol} ${v.name}`.toLowerCase().includes(query.toLowerCase())) : [];
      const result = query.toUpperCase().startsWith('TQ:') ? { results: [], meta: { provider: 'tqsdk', warnings: [] } } : await searchSymbols(query, { includeDomestic: domesticFutures, catalog: publicCatalog() });
      return { ...result, results: [...own, ...result.results] };
    },
  };
}
