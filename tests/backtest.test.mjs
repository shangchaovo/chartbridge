import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from '../src/backtest.js';

const time = i => 1700000000000 + i * 60000;
const bars = prices => prices.map((price, i) => ({ timestamp: time(i), open: price, high: price, low: price, close: price, volume: 1 }));
const zeroCosts = { initialCapital: 1000, feeBps: 0, slippageBps: 0 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test('a close signal buys at the following open, with costs on both fills', () => {
  const candles = bars([10, 30, 40]);
  candles[1].open = 20;
  candles[1].low = 20;
  const result = runBacktest(candles, { ...zeroCosts, strategy: 'buy-hold', feeBps: 100, slippageBps: 100 });
  const trade = result.trades[0];
  assert.equal(trade.entryTimestamp, time(1));
  assert.equal(trade.entrySignalTimestamp, time(0));
  near(trade.entryPrice, 20.2);
  near(trade.quantity, 1000 / (20.2 * 1.01));
  near(trade.exitPrice, 39.6);
  near(result.metrics.finalEquity, (1000 / (20.2 * 1.01)) * 39.6 * 0.99);
  near(trade.pnl, result.metrics.finalEquity - 1000);
  near(result.metrics.totalFees, trade.entryFee + trade.exitFee);
  assert.equal(trade.forcedExit, true);
  assert.equal(trade.exitReason, 'end-of-data');
  assert.equal(result.markers.at(-1).text, '期末清算');
  near(result.equity[0].equity, 1000);
  near(result.equity[1].equity, trade.quantity * 30);
  assert.equal(result.equity.at(-1).positionValue, 0);
});

test('fees and adverse slippage lose money in a flat market', () => {
  const candles = bars([100, 100, 100, 100]);
  const free = runBacktest(candles, { ...zeroCosts, strategy: 'buy-hold' });
  const paid = runBacktest(candles, { ...zeroCosts, strategy: 'buy-hold', feeBps: 100, slippageBps: 50 });
  near(free.metrics.finalEquity, 1000);
  near(paid.metrics.finalEquity, 1000 * (0.995 * 0.99) / (1.005 * 1.01));
  assert.ok(paid.metrics.totalFees > 0);
  assert.ok(paid.metrics.totalSlippage > 0);
  assert.equal(paid.metrics.winRate, 0);
  assert.equal(paid.metrics.profitFactor, 0);
});

test('drawdown includes unrealized losses even when the final trade breaks even', () => {
  const result = runBacktest(bars([100, 100, 50, 100]), { ...zeroCosts, strategy: 'buy-hold' });
  near(result.metrics.totalReturn, 0);
  near(result.metrics.maxDrawdown, 0.5);
  near(result.equity[2].equity, 500);
  near(result.equity[2].drawdown, 0.5);
  near(result.equity[3].drawdown, 0);
});

test('appending future candles cannot change earlier signals or marked equity', () => {
  const history = bars([10, 9, 8, 9, 10, 11, 10, 9]);
  const config = { ...zeroCosts, strategy: 'ema-cross', fast: 2, slow: 3 };
  const prefix = runBacktest(history, config);
  const extended = runBacktest([...history, ...bars([1000, 1, 1000]).map((bar, i) => ({ ...bar, timestamp: time(history.length + i) }))], config);
  assert.deepEqual(prefix.equity.slice(0, -1), extended.equity.slice(0, history.length - 1));
  assert.deepEqual(prefix.markers.filter(marker => !marker.forcedExit), extended.markers.filter(marker => marker.timestamp < time(history.length) && !marker.forcedExit));
  assert.equal(prefix.trades[0].entryTimestamp, time(5));
  assert.equal(prefix.trades[0].entrySignalTimestamp, time(4));
});

test('Wilder RSI waits for a complete warmup and executes at the next open', () => {
  const result = runBacktest(bars([10, 9, 8, 9, 10, 11]), { ...zeroCosts, strategy: 'rsi', rsiPeriod: 2 });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTimestamp, time(3));
  assert.equal(result.trades[0].exitTimestamp, time(5));
  assert.equal(result.trades[0].forcedExit, false);
  assert.equal(result.trades[0].exitReason, 'rsi-overbought');
  near(result.metrics.finalEquity, 1000 * 11 / 9);
  assert.equal(result.metrics.profitFactor, null);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('one strategy fill per bar; a final cleanup is separately marked', () => {
  const result = runBacktest(bars([10, 9, 8, 9]), { ...zeroCosts, strategy: 'rsi', rsiPeriod: 2 });
  const strategyFills = result.markers.filter(marker => !marker.forcedExit);
  assert.equal(new Set(strategyFills.map(marker => marker.timestamp)).size, strategyFills.length);
  assert.equal(strategyFills.length, 1);
  assert.equal(result.markers.length, 2);
  assert.equal(result.markers[0].timestamp, result.markers[1].timestamp);
  assert.equal(result.markers[1].forcedExit, true);
  assert.equal(result.trades[0].holdBars, 0);
});

test('short histories produce no trades instead of guessing an EMA signal', () => {
  const result = runBacktest(bars([10, 11, 12]), zeroCosts);
  assert.equal(result.trades.length, 0);
  near(result.metrics.finalEquity, 1000);
  assert.equal(result.metrics.profitFactor, null);
  near(result.metrics.benchmarkReturn, 0.2);
});

test('invalid prices, ordering, OHLC ranges, costs and strategy settings are rejected', () => {
  const candles = bars([10, 11, 12]);
  assert.throws(() => runBacktest([]), /至少需要两根/);
  assert.throws(() => runBacktest(candles, null), /参数必须/);
  assert.throws(() => runBacktest([{ ...candles[0], close: NaN }, ...candles.slice(1)]), /OHLCV/);
  assert.throws(() => runBacktest([candles[0], candles[0]]), /未严格递增/);
  assert.throws(() => runBacktest([{ ...candles[0], low: 11 }, ...candles.slice(1)]), /高低价/);
  for (const invalid of [{ feeBps: -1 }, { slippageBps: 10000 }, { initialCapital: 0 }, { fast: 3, slow: 2 }, { rsiPeriod: 1.5 }, { oversold: 80, overbought: 70 }, { strategy: 'unknown' }]) {
    assert.throws(() => runBacktest(candles, invalid));
  }
});
