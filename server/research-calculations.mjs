import { runPineScript } from '../src/pine-runtime.js';
import { runBacktest } from '../src/backtest.js';

// Only validated numbers and fixed identifiers enter this source. Remote clients
// cannot submit Pine/JavaScript for execution on the host.
function indicatorSource(indicators) {
  const lines = ['//@version=6', 'indicator("LAN indicator research")'];
  indicators.forEach((item, index) => {
    const id = `I${index + 1}_${item.type}`, variable = `v${index}`;
    if (item.type === 'MACD') {
      lines.push(`[${variable}a, ${variable}b, ${variable}c] = ta.macd(close, ${item.fast}, ${item.slow}, ${item.signal})`);
      for (const [suffix, label] of [['a', 'MACD'], ['b', 'signal'], ['c', 'histogram']]) lines.push(`plot(${variable}${suffix}, "${id}_${label}")`);
    } else if (item.type === 'BB') {
      lines.push(`[${variable}a, ${variable}b, ${variable}c] = ta.bb(close, ${item.period}, ${item.multiplier})`);
      for (const [suffix, label] of [['a', 'basis'], ['b', 'upper'], ['c', 'lower']]) lines.push(`plot(${variable}${suffix}, "${id}_${label}")`);
    } else {
      const expression = item.type === 'ATR' ? `ta.atr(${item.period})` : `ta.${item.type.toLowerCase()}(close, ${item.period})`;
      lines.push(`plot(${expression}, "${id}_${item.period}")`);
    }
  });
  return lines.join('\n');
}

export async function calculateResearch({ kind, input, candles }) {
  if (kind === 'indicators') {
    const result = await runPineScript({ code: indicatorSource(input.indicators), candles, symbol: input.symbol, interval: input.interval });
    if (!result.ok) throw Object.assign(new Error(result.error.details || result.error.message), { code: result.error.code });
    return { engine: result.engine, indicators: input.indicators, series: result.plots.map(plot => ({ name: plot.title, latest: plot.data.at(-1), points: plot.data.slice(-input.tail) })),
      // These fixed numeric scripts do not use drawing APIs. The browser's
      // visual-rendering caveat does not apply to their numeric API results.
      warnings: result.warnings.filter(warning => !warning.startsWith('当前图表未完整呈现：')) };
  }
  if (kind === 'backtest') {
    const result = runBacktest(candles, input.options);
    return { engine: { name: 'Shanhai backtest', version: '1', execution: 'next-bar-open' }, options: result.options,
      metrics: result.metrics, trades: result.trades.slice(-input.tail), equity: result.equity.slice(-input.tail),
      tradeCount: result.trades.length, equityCount: result.equity.length, warnings: result.warnings };
  }
  throw Object.assign(new Error('不支持的研究任务。'), { code: 'INVALID_RESEARCH_KIND' });
}
