/** Live instrument lists from the public hosts this app already uses. No new exchanges. */
const spotSymbol = symbol => /^[A-Z0-9]{1,24}(?:USDT|USDC|FDUSD|USD1|U)$/.test(symbol);
const okxSymbol = symbol => /^OKX:[A-Z0-9-]{3,20}$/.test(symbol);
const krakenSymbol = symbol => /^KRAKEN:[A-Z0-9/]{3,20}$/.test(symbol);
const perpSymbol = symbol => /^BINANCE:[A-Z0-9]{1,24}(?:USDT|USDC|USD1)$/.test(symbol);

export function parseBinanceSpot(payload) {
  const rows = [];
  for (const item of payload?.symbols || []) {
    if (item?.status !== 'TRADING' || item?.isSpotTradingAllowed === false) continue;
    if (!['USDT', 'USDC', 'FDUSD', 'USD1', 'U'].includes(item.quoteAsset)) continue;
    const symbol = String(item.symbol || '');
    if (!spotSymbol(symbol)) continue;
    rows.push({
      symbol: item.quoteAsset === 'U' ? `BINANCE-SPOT:${symbol}` : symbol,
      name: `${item.baseAsset} / ${item.quoteAsset}`, market: 'crypto', exchange: 'BINANCE',
      currency: item.quoteAsset, type: 'crypto', provider: 'binance', baseAsset: item.baseAsset,
    });
  }
  return rows;
}

/** bStocks are identified by Binance's asset metadata, including tokens without a matching perpetual. */
export function enrichBinanceAssets(rows, payload) {
  const assets = new Map((Array.isArray(payload?.data) ? payload.data : []).map(item => [item.assetCode, item]));
  return rows.map(row => {
    if (row.provider !== 'binance') return row;
    const baseAsset = row.baseAsset || row.symbol.replace(/^BINANCE-SPOT:/, '').replace(/(?:FDUSD|USDT|USDC|USD1|U)$/, '');
    const asset = assets.get(baseAsset);
    if (!asset || !/bStocks/i.test(asset.assetName || '') || !baseAsset.endsWith('B')) return row;
    const underlying = baseAsset.slice(0, -1);
    return { ...row, baseAsset, market: 'us-binance', type: 'stock-token', underlyingMarket: 'us',
      underlyingSymbol: underlying === 'BRKB' ? 'BRK-B' : underlying,
      name: `${asset.assetName.replace(/\s*[（(]bStocks[)）]/i, '').trim()} ${row.currency} 股票代币` };
  });
}

export function parseBinancePerpetuals(payload) {
  const rows = [];
  for (const item of payload?.symbols || []) {
    const stock = ['EQUITY', 'KR_EQUITY', 'HK_EQUITY', 'CN_EQUITY', 'PREMARKET'].includes(item?.underlyingType);
    const commodity = item?.underlyingType === 'COMMODITY';
    if (item?.status !== 'TRADING' || !['PERPETUAL', 'TRADIFI_PERPETUAL'].includes(item?.contractType)) continue;
    if (item.contractType === 'TRADIFI_PERPETUAL' && !stock && !commodity) continue;
    if (stock ? !['USDT', 'USDC', 'USD1'].includes(item.quoteAsset) : item.quoteAsset !== 'USDT') continue;
    const symbol = `BINANCE:${item.symbol}`;
    if (!perpSymbol(symbol)) continue;
    const underlyingSymbol = item.baseAsset === 'BRKB' ? 'BRK-B' : item.baseAsset;
    rows.push({
      symbol, name: `${item.baseAsset === 'SKHYNIX' ? 'SK 海力士 SKHYNIX' : commodity ? ({XAU:'黄金 XAU',XAG:'白银 XAG'})[item.baseAsset] || item.baseAsset : item.baseAsset} ${item.quoteAsset} ${stock ? ({ EQUITY: '美股', KR_EQUITY: '韩股', HK_EQUITY: '港股', CN_EQUITY: '中国股票', PREMARKET: '盘前股票' })[item.underlyingType] : ''}永续`, market: stock ? 'us-binance' : commodity ? 'futures' : 'crypto', exchange: 'BINANCE',
      currency: item.quoteAsset, type: 'perpetual', provider: 'binance-perp', baseAsset: item.baseAsset,
      ...(commodity ? {underlyingType:'COMMODITY',underlyingSymbol:item.baseAsset} : {}),
      ...(stock ? { underlyingSymbol, underlyingType: item.underlyingType,
        underlyingMarket: ({ EQUITY: 'us', KR_EQUITY: 'kr', HK_EQUITY: 'hk', CN_EQUITY: 'cn', PREMARKET: 'pre-ipo' })[item.underlyingType] } : {}),
      contractType: item.contractType, status: item.status,
    });
  }
  return rows;
}

export function parseOkxSpot(payload) {
  const rows = [];
  for (const item of payload?.data || []) {
    if (item?.state !== 'live' || item?.instType !== 'SPOT') continue;
    if (!['USDT', 'USDC', 'USD'].includes(item.quoteCcy)) continue;
    const symbol = `OKX:${item.instId}`;
    if (!okxSymbol(symbol)) continue;
    rows.push({
      symbol, name: `${item.baseCcy} / ${item.quoteCcy}`, market: 'crypto', exchange: 'OKX',
      currency: item.quoteCcy, type: 'crypto', provider: 'okx',
    });
  }
  return rows;
}

export function parseKrakenPairs(payload) {
  const rows = [];
  for (const value of Object.values(payload?.result || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (value.status && value.status !== 'online') continue;
    const ws = String(value.wsname || '');
    if (!ws.includes('/')) continue;
    let [base, quote] = ws.toUpperCase().split('/');
    base = base.replace(/^XBT/, 'BTC').replace(/^XDG/, 'DOGE');
    if (!['USD', 'USDT', 'USDC', 'EUR', 'JPY', 'GBP'].includes(quote)) continue;
    const symbol = `KRAKEN:${base}/${quote}`;
    if (!krakenSymbol(symbol)) continue;
    rows.push({
      symbol, name: `${base} / ${quote}`, market: 'crypto', exchange: 'KRAKEN',
      currency: quote, type: 'crypto', provider: 'kraken',
    });
  }
  return rows;
}

/** Static names win so the curated Chinese labels stay. */
export function mergeCatalog(base, extra) {
  const map = new Map();
  for (const item of extra || []) if (item?.symbol) map.set(item.symbol, item);
  for (const item of base || []) if (item?.symbol) {
    const live = map.get(item.symbol);
    map.set(item.symbol, live?.provider === 'binance-perp' ? {
      ...item, ...live, name: item.name, market: live.underlyingType ? live.market : item.market || live.market,
    } : item);
  }
  for (const [symbol, item] of map) if (item.provider === 'binance-perp' && item.market === 'us-binance' && item.underlyingSymbol) {
    const underlying = map.get(item.underlyingSymbol);
    if (underlying?.market === 'us') map.set(symbol, { ...item, name: `${underlying.name} ${item.currency} 美股永续` });
    else if (item.underlyingMarket && item.underlyingMarket !== 'us') {
      const region = ({ kr: '韩股', hk: '港股', cn: '中国股票', 'pre-ipo': '盘前股票' })[item.underlyingMarket];
      if (region) map.set(symbol, { ...item, name: `${item.baseAsset === 'SKHYNIX' ? 'SK 海力士 SKHYNIX' : item.baseAsset} ${item.currency} ${region}永续` });
    }
  }
  const stockUnderlyings = new Map([...map.values()].filter(item => item.market === 'us-binance' && item.type === 'perpetual' && item.baseAsset)
    .map(item => [item.baseAsset, item]));
  for (const [symbol, item] of map) if (item.provider === 'binance') {
    const asset = item.baseAsset || symbol.replace(/USDT$|USDC$|FDUSD$|USD1$/, '');
    const underlying = asset.endsWith('B') && stockUnderlyings.get(asset.slice(0, -1));
    if (underlying) map.set(symbol, { ...item, baseAsset: asset, market: 'us-binance', type: 'stock-token',
      underlyingSymbol: underlying.underlyingSymbol, underlyingMarket: underlying.underlyingMarket,
      name: `${map.get(underlying.underlyingSymbol)?.name || asset.slice(0,-1)} ${item.currency} 股票代币` });
  }
  return [...map.values()];
}

export function catalogCounts(rows) {
  const counts = {};
  for (const row of rows || []) {
    const key = row.provider || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export async function loadPublicCatalog({ fetchImpl = fetch, base = [], timeoutMs = 20000 } = {}) {
  const jobs = [
    ['https://data-api.binance.vision/api/v3/exchangeInfo', parseBinanceSpot],
    ['https://www.binance.com/fapi/v1/exchangeInfo', parseBinancePerpetuals],
    ['https://www.okx.com/api/v5/public/instruments?instType=SPOT', parseOkxSpot],
    ['https://api.kraken.com/0/public/AssetPairs', parseKrakenPairs],
  ];
  const extra = [];
  const errors = [];
  for (const [url, parse] of jobs) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      extra.push(...parse(await response.json()));
    } catch (error) {
      errors.push({ url, message: error.message });
    }
  }
  let results = mergeCatalog(base, extra);
  const assetUrl = 'https://www.binance.com/bapi/asset/v2/public/asset/asset/get-all-asset';
  try {
    const response = await fetchImpl(assetUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    results = enrichBinanceAssets(results, await response.json());
  } catch (error) { errors.push({ url: assetUrl, message: error.message }); }
  return { results, counts: catalogCounts(results), errors };
}

export async function loadBinancePerpetualCatalog({ fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  let lastError;
  for (const sourceUrl of ['https://www.binance.com/fapi/v1/exchangeInfo', 'https://fapi.binance.com/fapi/v1/exchangeInfo']) {
    try {
      const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload?.symbols) || !payload.symbols.length) throw new Error('币安合约目录无效，保留上次同步结果。');
      const results = parseBinancePerpetuals(payload);
      if (!results.length) throw new Error('币安合约目录为空，保留上次同步结果。');
      return { results, sourceUrl };
    } catch (error) { lastError = error; }
  }
  throw lastError;
}
