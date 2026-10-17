import { PineTS } from 'pinets';
import { canonicalSymbol,collectPineRequests,intervalMs } from './pine-data.js';

export const PINE_ENGINE = { name: 'PineTS', version: '0.11.1', compatibility: 'experimental' };

const LIMITS = { source: 100_000, candles: 20_000, plots: 64, loops: 100_000 };
const DEFAULT_COLOR = '#5b9cf6';

class PineError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// Used for input checks only; PineTS parses and executes the actual source.
function withoutLiterals(code) {
  return code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => token.replace(/[^\n]/g, ' '));
}

function timeframeFor(interval) {
  const value = String(interval ?? '1D').trim();
  if (/^\d+$/.test(value) && Number(value) > 0) return value;
  if (/^(?:\d+)?[SDWM]$/.test(value)) return /^\d/.test(value) ? value : `1${value}`;
  const units = { s: 'S', m: '', h: 'h', d: 'D', w: 'W', mo: 'M' };
  const match = value.match(/^(\d+)(s|m|h|d|w|mo)$/);
  if (match && Number(match[1]) > 0) {
    return match[2] === 'h' ? String(Number(match[1]) * 60) : `${match[1]}${units[match[2]]}`;
  }
  throw new PineError('INVALID_INTERVAL', `不支持周期“${value}”。`, '使用 1m、15m、1h、1d、1w、1M 或 Pine 周期格式。');
}

function validateSource(code) {
  if (typeof code !== 'string' || !code.trim()) throw new PineError('EMPTY_SCRIPT', '请先输入 Pine Script。');
  if (code.length > LIMITS.source) throw new PineError('SCRIPT_TOO_LARGE', '脚本超过本地执行长度限制。');
  const version = code.match(/^\s*\/\/@version\s*=\s*(\d+)\s*$/m)?.[1];
  if (version !== '5' && version !== '6') {
    throw new PineError('UNSUPPORTED_VERSION', '本地执行层仅接受原生 Pine v5 / v6。', '在脚本首部添加 //@version=5 或 //@version=6；旧脚本需要先迁移。');
  }
  const source = withoutLiterals(code);
  if (!/\b(?:indicator|strategy)\s*\(/.test(source)) {
    throw new PineError('MISSING_DECLARATION', '脚本需要 indicator() 或 strategy() 声明。');
  }
  if (/\b(?:globalThis|window|document|self|process|require|eval|Function|fetch|XMLHttpRequest|WebSocket|Worker|importScripts|constructor|__proto__|prototype)\b|\bimport\s*\(/.test(source)) {
    throw new PineError('NATIVE_PINE_ONLY', '本地编辑器只运行原生 Pine，不能调用 JavaScript 宿主 API。');
  }
  return { source, version: Number(version) };
}

function marketDataFor(candles,interval) {
  if (!Array.isArray(candles) || !candles.length) throw new PineError('NO_CANDLES', '当前没有可计算的 K 线。');
  if (candles.length > LIMITS.candles) throw new PineError('TOO_MANY_CANDLES', `每次最多计算 ${LIMITS.candles} 根 K 线。`);
  return candles.map((bar, index) => {
    if (!bar || !['timestamp', 'open', 'high', 'low', 'close', 'volume'].every((key) => Number.isFinite(bar[key]))) {
      throw new PineError('INVALID_CANDLES', `第 ${index + 1} 根 K 线缺少有效的 timestamp / OHLCV 数值。`, 'timestamp 使用毫秒；OHLCV 使用有限数字。');
    }
    if (index > 0 && bar.timestamp <= candles[index - 1].timestamp) {
      throw new PineError('INVALID_CANDLES', 'K 线时间必须严格递增且不能重复。');
    }
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high) || bar.volume < 0) {
      throw new PineError('INVALID_CANDLES', `第 ${index + 1} 根 K 线的 OHLCV 范围无效。`);
    }
    return { openTime: bar.timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
      ...(Number.isFinite(bar.closeTime) ? { closeTime: bar.closeTime } : intervalMs[interval]?{closeTime:bar.timestamp+intervalMs[interval]-1}:{}) };
  });
}

function chartProvider(data, symbol, timeframe,datasets=[]) {
  const bareSymbol = symbol.includes(':') ? symbol.split(':').slice(1).join(':') : symbol;
  const sources=new Map([[`${bareSymbol}|${timeframe}`,data]]);
  for(const dataset of datasets){const ticker=dataset.symbol.replace(/^[^:]+:/,'');const key=`${ticker}|${timeframeFor(dataset.interval)}`;if(sources.has(key))throw new PineError('AMBIGUOUS_DATASET',`数据集 ${key} 出现重复或同名交易所映射。`);sources.set(key,marketDataFor(dataset.candles,dataset.interval));}
  return {
    async getMarketData(requestedSymbol, requestedTimeframe,limit,start,end) {
      const requestedBare = String(requestedSymbol).replace(/^[^:]+:/, '');
      const rows=sources.get(`${requestedBare}|${timeframeFor(requestedTimeframe)}`);
      if(!rows){
        throw new PineError('DATA_UNAVAILABLE', `当前只载入 ${symbol} · ${timeframe} 的 K 线，缺少 ${requestedSymbol} · ${requestedTimeframe} 数据。`,
          '跨标的 / 跨周期 request.security() 需要另行载入对应数据；不会把当前 K 线冒充其他周期。');
      }
      const filtered=rows.filter(b=>(!Number.isFinite(start)||b.openTime>=start)&&(!Number.isFinite(end)||b.openTime<=end));return limit?filtered.slice(-limit):filtered;
    },
    async getSymbolInfo(requestedSymbol=symbol) {
      const bare=String(requestedSymbol).replace(/^[^:]+:/,'');return { ticker:bare,tickerid:requestedSymbol,main_tickerid:requestedSymbol,prefix:String(requestedSymbol).includes(':')?String(requestedSymbol).split(':')[0]:'',description:requestedSymbol };
    },
  };
}

function plainNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorResult(error, warnings) {
  const details = String(error?.message ?? error).slice(0, 1500);
  const syntax = error instanceof SyntaxError || /syntax|unexpected|expected|parse error/i.test(details);
  const unsupported = /not (?:a function|implemented)|unsupported|is not defined/i.test(details);
  const code = error?.code ?? (syntax ? 'PINE_SYNTAX' : unsupported ? 'PINE_UNSUPPORTED' : 'PINE_RUNTIME');
  const location = details.match(/(?:line\s*|\()(\d+)(?::|,\s*(?:column\s*)?)(\d+)/i);
  return { ok: false, engine: PINE_ENGINE, plots: [], markers: [], warnings,
    error: { code, message: error instanceof PineError ? details : syntax ? 'Pine 编译失败，请检查脚本语法。' : unsupported ? '脚本使用了执行引擎尚未支持的语法或函数。' : 'Pine 脚本运行失败。',
      details, hint: error?.hint ?? 'PineTS 的 v5 / v6 支持处于实验阶段；请检查错误详情或先运行示例指标。',
      ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}) } };
}

function outputsFor(context, data, warnings) {
  const plots = [];
  const markers = [];
  const indexes = new Map(data.map((bar, index) => [bar.openTime, index]));
  const unsupported = new Set();
  const entries = Object.entries(context.plots ?? {});
  if (entries.length > LIMITS.plots) warnings.push(`仅显示前 ${LIMITS.plots} 个绘图输出。`);
  const shiftedTime = (point, options) => {
    const offset = Number(options.offset ?? 0);
    if (!Number.isFinite(point.time)) return null;
    if (!offset) return point.time;
    const index = indexes.get(point.time);
    if (!Number.isInteger(offset) || index === undefined || !data[index + offset]) {
      unsupported.add('超出已载入 K 线的 offset');
      return null;
    }
    return data[index + offset].openTime;
  };
  for (const [id, plot] of entries.slice(0, LIMITS.plots)) {
    const options = plot.options ?? {};
    const style = options.style ?? 'style_line';
    const title = plot.title || id || 'Plot';
    if (options.display === 'none' || options.display === 0) continue;
    if (style === 'shape' || style === 'char') {
      for (const point of plot.data ?? []) {
        const pointOptions = { ...options, ...point.options };
        const absolute = String(pointOptions.location).toLowerCase() === 'absolute';
        if (absolute ? !Number.isFinite(point.value) : !point.value || Number.isNaN(point.value)) continue;
        const time = shiftedTime(point, pointOptions);
        if (time === null) continue;
        const shape = String(pointOptions.shape ?? 'circle').toLowerCase();
        const location = String(pointOptions.location ?? 'abovebar').toLowerCase();
        markers.push({ id: `${id}:${point.time}`, time, title,
          position: absolute || location === 'inbar' ? 'inBar' : location.includes('below') || location === 'bottom' ? 'belowBar' : 'aboveBar',
          shape: /up/.test(shape) ? 'arrowUp' : /down/.test(shape) ? 'arrowDown' : /square/.test(shape) ? 'square' : 'circle',
          color: typeof pointOptions.color === 'string' ? pointOptions.color : DEFAULT_COLOR,
          text: String(pointOptions.text ?? pointOptions.char ?? title),
          ...(absolute ? { value: point.value } : {}) });
        if (absolute) unsupported.add('location.absolute 标记的精确纵坐标');
      }
      continue;
    }
    if (!['style_line', 'style_linebr', 'style_histogram', 'style_columns', 'hline', 'style_area', 'style_areabr', 'style_stepline', 'style_steplinebr', 'style_circles', 'style_cross', 'style_stepline_diamond'].includes(style)) {
      unsupported.add(style);
      continue;
    }
    const points = [];
    for (const point of plot.data ?? []) {
      const pointOptions = { ...options, ...point.options };
      const time = shiftedTime(point, pointOptions);
      if (time === null) continue;
      points.push({ time, value: plainNumber(point.value), ...(typeof pointOptions.color === 'string' ? { color: pointOptions.color } : {}) });
    }
    plots.push({ id, title, type: /histogram|columns/.test(style) ? 'histogram' : 'line', style,
      color: typeof options.color === 'string' ? options.color : DEFAULT_COLOR,
      width: Math.min(5, Math.max(1, Number(options.linewidth) || 1)), overlay: options.overlay ?? context.indicator?.overlay ?? false, data: points });
    if (/area|step|circles|cross/.test(style)) unsupported.add(`${style} 按普通折线显示`);
  }
  if (unsupported.size) warnings.push(`当前图表未完整呈现：${[...unsupported].join('、')}。`);
  return { plots, markers: markers.sort((a, b) => a.time - b.time) };
}

/** Run in a disposable Web Worker; the UI owns the wall-clock timeout and termination. */
export async function runPineScript({ code, candles, symbol = 'LOCAL', interval = '1D',datasets=[] } = {}) {
  const warnings = ['PineTS v5 / v6 兼容为实验功能，结果未保证与 TradingView 完全一致。'];
  try {
    const { source, version } = validateSource(code);
    const data = marketDataFor(candles,interval);
    const timeframe = timeframeFor(interval);
    const ticker = String(symbol || 'LOCAL');
    const requests=collectPineRequests(code,ticker,interval),canonical=canonicalSymbol(ticker);
    if(!Array.isArray(datasets)||datasets.length>8)throw new PineError('TOO_MANY_DATASETS','辅助行情最多 8 组。');
    const normalized=datasets.map(d=>({...d,symbol:canonicalSymbol(d.symbol)}));
    for(const request of requests){
      if(request.symbol===canonical&&timeframeFor(request.interval)===timeframe)continue;
      const dataset=normalized.find(d=>d.symbol===request.symbol&&d.interval===request.interval);
      if(!dataset)throw new PineError('DATA_UNAVAILABLE',`缺少 ${request.symbol} · ${request.interval} 的独立行情数据。`,'先载入脚本请求的数据集。');
      if(timeframeFor(request.interval)!==timeframe&&(!/^(?:BINANCE:)?[A-Z0-9]+(?:USDT|USDC|FDUSD)$/.test(ticker)||!/[A-Z0-9]+(?:USDT|USDC|FDUSD)$/.test(request.symbol)))throw new PineError('REQUEST_CALENDAR_UNVERIFIED','跨周期目前仅开放 Binance 24/7 行情；其他市场需先验证交易日历与收盘时间。');
      if(!dataset.candles?.some(b=>b.timestamp<=data.at(-1).openTime))throw new PineError('DATA_RANGE_UNAVAILABLE','辅助数据与当前图表区间没有重叠。');
    }
    const engine = new PineTS(chartProvider(data, canonical, timeframe,normalized), canonical, timeframe, data.length,
      data[0].openTime, data[data.length - 1].closeTime ?? data[data.length - 1].openTime);
    engine.setMaxLoops(LIMITS.loops);
    const context = await engine.run(code);
    if(requests.some(r=>r.symbol!==canonical||timeframeFor(r.interval)!==timeframe))warnings.push('已使用独立数据集计算 request.security；低周期、动态代码、完整交易日历与全部请求语义仍未实现。实时高周期值可能随未收盘行情变化。');
    const { plots, markers } = outputsFor(context, data, warnings);
    if (/\b(?:syminfo\s*\.|session\s*\.|time_close\b|timestamp\s*\(|hour\b|dayofweek\b)/.test(source) || context.strategy) {
      warnings.push('未提供交易所日历、合约乘数、最小价格变动和账户换汇；相关计算使用引擎默认值（UTC 等），time_close 可能为周期估算。');
    }
    if (context.strategy) warnings.push('strategy() 已由 PineTS 执行；当前仅返回绘图与实验性统计。撮合、OCA、保证金和币种换算可能与 TradingView 不同。');
    for (const warning of context.warnings ?? []) warnings.push(String(warning.message ?? warning));
    if (!plots.length && !markers.length) warnings.push('脚本未产生当前图表可显示的 plot / plotshape / plotchar 输出。');
    return { ok: true, engine: PINE_ENGINE, indicator: { title: context.indicator?.title ?? context.strategy?.config?.title ?? 'Pine Script',
      overlay: context.indicator?.overlay ?? context.strategy?.config?.overlay ?? false, version, kind: context.strategy ? 'strategy' : 'indicator' },
      plots, markers, warnings: [...new Set(warnings)].slice(0, 40),
      ...(context.strategy ? { strategy: { experimental: true, initialCapital: plainNumber(context.strategy.initial_capital),
        equity: plainNumber(context.strategy.equity), netProfit: plainNumber(context.strategy.netprofit),
        closedTradeCount: context.strategy.closedtrades?.length ?? 0, openTradeCount: context.strategy.opentrades?.length ?? 0,
        positionSize: plainNumber(context.strategy.position_size) } } : {}) };
  } catch (error) {
    return errorResult(error, warnings);
  }
}
