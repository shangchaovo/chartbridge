const DEFAULTS = {
  strategy: 'ema-cross', fast: 12, slow: 26, rsiPeriod: 14,
  oversold: 30, overbought: 70, initialCapital: 100000, feeBps: 10, slippageBps: 5,
};

function validate(candles, options) {
  if (!Array.isArray(candles) || candles.length < 2) throw new TypeError('回测至少需要两根 K 线。');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('回测参数必须是对象。');
  const config = { ...DEFAULTS, ...options };
  if (!['ema-cross', 'rsi', 'buy-hold'].includes(config.strategy)) throw new RangeError('不支持的回测策略。');
  for (const name of ['fast', 'slow', 'rsiPeriod']) {
    if (!Number.isInteger(config[name]) || config[name] < 1) throw new RangeError(`${name} 必须为正整数。`);
  }
  if (config.fast >= config.slow) throw new RangeError('EMA 快线周期必须小于慢线周期。');
  if (!Number.isFinite(config.initialCapital) || config.initialCapital <= 0) throw new RangeError('初始资金必须大于零。');
  for (const name of ['feeBps', 'slippageBps']) {
    if (!Number.isFinite(config[name]) || config[name] < 0 || config[name] >= 10000) throw new RangeError(`${name} 必须在 0 到 10000 基点之间。`);
  }
  if (!Number.isFinite(config.oversold) || !Number.isFinite(config.overbought)
    || config.oversold < 0 || config.overbought > 100 || config.oversold >= config.overbought) {
    throw new RangeError('RSI 阈值必须满足 0 ≤ 超卖 < 超买 ≤ 100。');
  }
  candles.forEach((bar, index) => {
    if (!bar || !Number.isSafeInteger(bar.timestamp) || bar.timestamp < 0
      || (index > 0 && bar.timestamp <= candles[index - 1].timestamp)) throw new TypeError(`第 ${index + 1} 根 K 线的毫秒时间戳无效或未严格递增。`);
    if (['open', 'high', 'low', 'close'].some(key => !Number.isFinite(bar[key]) || bar[key] <= 0)
      || !Number.isFinite(bar.volume) || bar.volume < 0) throw new TypeError(`第 ${index + 1} 根 K 线包含无效 OHLCV。`);
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw new RangeError(`第 ${index + 1} 根 K 线的高低价不一致。`);
  });
  return config;
}

function ema(values, period) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  const alpha = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    if (i < period) sum += values[i] / period;
    if (i === period - 1) result[i] = sum;
    else if (i >= period) result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

function rsi(values, period) {
  const result = Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (i <= period) {
      gain += Math.max(change, 0) / period;
      loss += Math.max(-change, 0) / period;
    } else {
      gain = gain * ((period - 1) / period) + Math.max(change, 0) / period;
      loss = loss * ((period - 1) / period) + Math.max(-change, 0) / period;
    }
    if (i >= period) result[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }
  return result;
}

/**
 * Long-only, all-in, fractional-position simulation on fully closed OHLCV bars.
 * Signals at a bar's close execute at the next bar's open; each fill pays fees
 * and adverse slippage. The last close liquidates any remaining position.
 * Returns/drawdowns use fractions (0.1 = 10%); the benchmark is the raw first-to-
 * last close return, without costs. EMA uses an SMA seed, RSI uses Wilder smoothing.
 */
export function runBacktest(candles, options = {}) {
  const config = validate(candles, options);
  const { strategy, initialCapital, feeBps, slippageBps } = config;
  const feeRate = feeBps / 10000;
  const slippageRate = slippageBps / 10000;
  const closes = candles.map(bar => bar.close);
  const fast = strategy === 'ema-cross' ? ema(closes, config.fast) : [];
  const slow = strategy === 'ema-cross' ? ema(closes, config.slow) : [];
  const strength = strategy === 'rsi' ? rsi(closes, config.rsiPeriod) : [];
  const trades = [];
  const equity = [];
  const markers = [];
  const warnings = ['按收盘信号、下一根开盘成交；全仓做多，允许小数数量，未模拟交易所最小下单量、停牌或流动性限制。'];
  let cash = initialCapital;
  let position = null;
  let pending = null;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let exposureBars = 0;
  let totalFees = 0;
  let totalSlippage = 0;

  function fill(side, index, referencePrice, reason, signalTimestamp, forcedExit = false) {
    const timestamp = candles[index].timestamp;
    const price = referencePrice * (side === 'buy' ? 1 + slippageRate : 1 - slippageRate);
    if (side === 'buy') {
      const quantity = cash / (price * (1 + feeRate));
      const entryFee = quantity * price * feeRate;
      position = { entryTimestamp: timestamp, entrySignalTimestamp: signalTimestamp, entryBarIndex: index, entryPrice: price, quantity, entryFee, entryReason: reason };
      cash = 0;
      totalFees += entryFee;
      totalSlippage += quantity * (price - referencePrice);
    } else {
      const exitFee = position.quantity * price * feeRate;
      const cost = position.quantity * position.entryPrice + position.entryFee;
      cash += position.quantity * price - exitFee;
      const pnl = cash - cost;
      trades.push({ ...position, exitTimestamp: timestamp, exitSignalTimestamp: signalTimestamp, exitBarIndex: index, exitPrice: price, exitFee, pnl, returnPct: pnl / cost, exitReason: reason, forcedExit, holdBars: index - position.entryBarIndex });
      totalFees += exitFee;
      totalSlippage += position.quantity * (referencePrice - price);
      position = null;
    }
    markers.push({ timestamp, barIndex: index, signalTimestamp, side, reason, forcedExit,
      position: side === 'buy' ? 'belowBar' : 'aboveBar', color: side === 'buy' ? '#26a69a' : '#ef5350',
      shape: side === 'buy' ? 'arrowUp' : 'arrowDown', text: forcedExit ? '期末清算' : side === 'buy' ? '买入' : '卖出' });
  }

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (pending) {
      fill(pending.side, i, bar.open, pending.reason, pending.signalTimestamp);
      pending = null;
    }
    if (position) exposureBars++;
    if (i === candles.length - 1 && position) {
      fill('sell', i, bar.close, 'end-of-data', null, true);
      warnings.push('末根 K 线按收盘价强制平仓，并计入卖出手续费和滑点；标记为期末清算。');
    }
    const positionValue = position ? position.quantity * bar.close : 0;
    const value = cash + positionValue;
    peak = Math.max(peak, value);
    const drawdown = (peak - value) / peak;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    equity.push({ timestamp: bar.timestamp, equity: value, cash, positionValue, drawdown });

    if (i === candles.length - 1) continue;
    let side = null;
    let reason = null;
    if (strategy === 'buy-hold' && i === 0) { side = 'buy'; reason = 'buy-hold'; }
    if (strategy === 'ema-cross' && i > 0 && slow[i - 1] !== null && fast[i - 1] !== null) {
      if (fast[i] > slow[i] && fast[i - 1] <= slow[i - 1]) { side = 'buy'; reason = 'ema-cross-up'; }
      if (fast[i] < slow[i] && fast[i - 1] >= slow[i - 1]) { side = 'sell'; reason = 'ema-cross-down'; }
    }
    if (strategy === 'rsi' && strength[i] !== null) {
      if (strength[i] <= config.oversold) { side = 'buy'; reason = 'rsi-oversold'; }
      if (strength[i] >= config.overbought) { side = 'sell'; reason = 'rsi-overbought'; }
    }
    if ((side === 'buy' && !position) || (side === 'sell' && position)) pending = { side, reason, signalTimestamp: bar.timestamp };
  }

  const finalEquity = equity.at(-1).equity;
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(trade.pnl, 0), 0);
  const grossLoss = -trades.reduce((sum, trade) => sum + Math.min(trade.pnl, 0), 0);
  if (!trades.length) warnings.push('样本内未完成交易；请增加历史数据或调整策略周期。');
  else if (!grossLoss) warnings.push('没有亏损交易，盈亏比不适用，返回 null。');
  return {
    trades, equity, markers, warnings, options: config,
    metrics: {
      initialCapital, finalEquity, netProfit: finalEquity - initialCapital,
      totalReturn: finalEquity / initialCapital - 1, benchmarkReturn: closes.at(-1) / closes[0] - 1,
      maxDrawdown, winRate: trades.length ? trades.filter(trade => trade.pnl > 0).length / trades.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      tradeCount: trades.length, grossProfit, grossLoss, totalFees, totalSlippage, exposureBars,
    },
  };
}
