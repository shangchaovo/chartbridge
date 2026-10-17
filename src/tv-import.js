const INTERVALS = {
  '1': '1m', '1m': '1m', '5': '5m', '5m': '5m', '15': '15m', '15m': '15m',
  '30': '30m', '30m': '30m', '60': '1h', '1h': '1h', '240': '4h', '4h': '4h',
  d: '1d', '1d': '1d', '1D': '1d', w: '1w', '1w': '1w', '1W': '1w',
};
const CHARTS = {
  candle: 'candle_solid', candles: 'candle_solid', candle_solid: 'candle_solid',
  hollow: 'candle_hollow', candle_hollow: 'candle_hollow',
  line: 'area', area: 'area', bars: 'ohlc', ohlc: 'ohlc',
};

export function normalizeImportedSymbol(raw) {
  const text = String(raw || '').trim();
  if (!text || text.startsWith('#') || /\s/.test(text)) return '';
  const upper = text.toUpperCase();
  const parts = upper.split(':');
  const venue = parts.length > 1 ? parts[0] : '';
  const ticker = parts.length > 1 ? parts.slice(1).join(':') : upper;
  let symbol = ticker || venue;
  if (venue === 'HKEX' && /^\d{1,5}$/.test(symbol)) symbol = `${symbol.padStart(4, '0')}.HK`;
  else if (venue === 'SSE' && /^\d{6}$/.test(symbol)) symbol = `${symbol}.SS`;
  else if ((venue === 'SZSE' || venue === 'SZ') && /^\d{6}$/.test(symbol)) symbol = `${symbol}.SZ`;
  else if (['NASDAQ', 'NYSE', 'AMEX', 'BINANCE', 'FX', 'TVC', 'SP', 'BATS', 'COINBASE', 'BITSTAMP', 'OANDA'].includes(venue)) symbol = ticker;
  if (!/^[A-Z0-9.@^=_-]{1,40}$/.test(symbol)) return '';
  return symbol;
}

function symbolList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[\n,]/);
  return [];
}

export function importTradingViewConfig(text, { watchlist = [], supportedIndicators = [] } = {}) {
  const source = String(text || '').trim();
  if (!source) throw new Error('文件是空的。');
  let data;
  const ignored = [];
  if (source.startsWith('{') || source.startsWith('[')) {
    try { data = JSON.parse(source); }
    catch { throw new Error('JSON 无法解析。'); }
    if (Array.isArray(data)) data = { symbols: data };
  } else {
    data = { symbols: source.split(/\r?\n/) };
  }
  if (!data || typeof data !== 'object') throw new Error('配置格式无法识别。');
  const known = new Set(['symbols', 'watchlist', 'symbol', 'interval', 'timeframe', 'chartType', 'style', 'indicators', 'indicatorParams', 'studies', 'name', 'title']);
  for (const key of Object.keys(data)) if (!known.has(key)) ignored.push(key);
  const incoming = [...symbolList(data.symbols), ...symbolList(data.watchlist)].map(normalizeImportedSymbol).filter(Boolean);
  const skippedSymbols = [...symbolList(data.symbols), ...symbolList(data.watchlist)].map(item => String(item || '').trim()).filter(item => item && !item.startsWith('#') && !normalizeImportedSymbol(item));
  if (skippedSymbols.length) ignored.push(`无法识别的代码 ${skippedSymbols.slice(0, 8).join('、')}`);
  const merged = [...watchlist];
  const added = [];
  for (const symbol of incoming) {
    if (merged.includes(symbol)) continue;
    if (merged.length >= 150) { ignored.push('自选超过 150 个，其余代码未导入'); break; }
    merged.push(symbol);
    added.push(symbol);
  }
  const symbol = normalizeImportedSymbol(data.symbol || '') || null;
  const interval = INTERVALS[String(data.interval || data.timeframe || '').trim()] || null;
  if ((data.interval || data.timeframe) && !interval) ignored.push(`周期 ${data.interval || data.timeframe}`);
  const chartType = CHARTS[String(data.chartType || data.style || '').trim()] || null;
  if ((data.chartType || data.style) && !chartType) ignored.push(`图表类型 ${data.chartType || data.style}`);
  const indicators = [];
  for (const name of symbolList(data.indicators)) {
    const label = String(name || '').trim().toUpperCase();
    if (supportedIndicators.includes(label)) indicators.push(label);
    else if (label) ignored.push(`指标 ${label}`);
  }
  for (const name of symbolList(data.studies)) {
    const label = String(name || '').trim();
    if (label) ignored.push(`指标 ${label}`);
  }
  let indicatorParams = null;
  if (data.indicatorParams && typeof data.indicatorParams === 'object' && !Array.isArray(data.indicatorParams)) {
    indicatorParams = {};
    for (const [name, params] of Object.entries(data.indicatorParams)) {
      const label = name.toUpperCase();
      if (!supportedIndicators.includes(label) || !Array.isArray(params)) ignored.push(`指标参数 ${name}`);
      else indicatorParams[label] = params.map(Number).filter(Number.isFinite);
    }
  }
  return { watchlist: merged, added, symbol, interval, chartType, indicators, indicatorParams, ignored };
}
