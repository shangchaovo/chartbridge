import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchService, executeResearch } from '../server/research.mjs';
import { createMarketScope } from '../server/market-scope.mjs';
import { formatResearchNote } from '../src/agent-research.js';

const start = Date.UTC(2025, 0, 1);
const bars = Array.from({ length: 40 }, (_, i) => ({ timestamp: start + i * 60000, closeTime: start + (i + 1) * 60000 - 1,
  open: 99.75 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000 + i, closed: i < 39 }));
const fixture = (rows = bars, meta = {}) => ({ candles: structuredClone(rows), quote: { timestamp: start + 40 * 60000 },
  meta: { provider: 'test-fixture', providerName: 'Unit test fixture', cache: 'fresh', warnings: ['fixture only'], ...meta } });
const service = (payload = fixture(), other = {}) => new ResearchService({ candles: async () => structuredClone(payload), ...other });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('Agent indicators use the real engine with known SMA/EMA/RSI/MACD/ATR/BB results', async () => {
  const result = await service().run('indicators', { symbol: 'btcusdt', interval: '1m', tail: 2, indicators: [
    { type: 'SMA', period: 3 }, { type: 'EMA', period: 3 }, { type: 'RSI', period: 14 },
    { type: 'MACD' }, { type: 'ATR', period: 14 }, { type: 'BB', period: 3, multiplier: 2 },
  ] });
  assert.equal(result.engine.version, '0.11.1');
  assert.equal(result.series.length, 10);
  assert.equal(result.data.symbol, 'BTCUSDT');
  assert.equal(result.data.usedBars, 39); assert.equal(result.data.excludedBars, 1);
  assert.equal(result.data.confirmedClosedBars, 39); assert.equal(result.data.to, bars[38].timestamp);
  const latest = Object.fromEntries(result.series.map(s => [s.name, s.latest.value]));
  near(latest.I1_SMA_3, 137); near(latest.I2_EMA_3, 137); near(latest.I3_RSI_14, 100);
  near(latest.I4_MACD_MACD, 7); near(latest.I4_MACD_signal, 7); near(latest.I4_MACD_histogram, 0);
  near(latest.I5_ATR_14, 2); near(latest.I6_BB_basis, 137); near(latest.I6_BB_upper, 137 + Math.sqrt(2 / 3) * 2);
  assert.ok(result.series.every(s => s.points.length === 2 && s.latest.time === bars[38].timestamp));
  assert.equal(result.data.source.provider, 'test-fixture'); assert.match(result.data.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.warnings.some(w => w.includes('实验')));
  assert.ok(!result.warnings.some(w => w.includes('当前图表未完整呈现')));
  const tiny = { ...result, series: [{ name: 'Small price', latest: { value: .00000001 } }] };
  assert.match(formatResearchNote(tiny), /0\.00000001/);
});

test('Unknown last closure is excluded and the inference is disclosed; tail does not change the computed sample', async () => {
  const payload = fixture(bars.map(({ closed, ...bar }) => bar));
  const a = await service(payload).run('indicators', { symbol: 'AAPL', interval: '1m', tail: 1 });
  const b = await service(payload).run('indicators', { symbol: 'AAPL', interval: '1m', tail: 10 });
  assert.equal(a.data.assumedClosedBars, 39); assert.equal(a.data.confirmedClosedBars, 0);
  assert.equal(a.data.excludedBars, 1); assert.equal(a.data.sha256, b.data.sha256);
  assert.deepEqual(a.series.map(s => s.latest), b.series.map(s => s.latest));
  assert.ok(a.warnings.some(w => w.includes('历史顺序推定')));
});

test('Explicit forming bars are excluded even in the middle; source-confirmed last bars are retained', async () => {
  const input = bars.map((bar, i) => ({ ...bar, closed: i !== 4 }));
  const result = await service(fixture(input)).run('indicators', { symbol: 'BTCUSDT', interval: '1m' });
  assert.equal(result.data.usedBars, 39); assert.equal(result.data.to, bars[39].timestamp);
  assert.equal(result.data.excludedBars, 1);
});

test('Including unclosed data is explicit and stale cache provenance is retained', async () => {
  const result = await service(fixture(bars, { cache: 'stale', cachedAt: 123 })).run('indicators', { symbol: 'BTCUSDT', closedOnly: false });
  assert.equal(result.data.usedBars, 40); assert.equal(result.data.unconfirmedBars, 1);
  assert.equal(result.data.source.cachedAt, 123); assert.equal(result.data.closedOnly, false);
  assert.ok(result.warnings.some(w => w.includes('断网历史缓存')));
  assert.ok(result.warnings.some(w => w.includes('末值可能随行情变化')));
});

test('Indicator warmup stays null and is explained', async () => {
  const result = await service(fixture(bars.slice(0, 3))).run('indicators', { symbol: 'BTCUSDT', indicators: [{ type: 'SMA', period: 100 }] });
  assert.equal(result.series[0].latest.value, null);
  assert.ok(result.warnings.some(w => w.includes('预热')));
});

test('Agent backtest uses next open and both costs, calculates full sample and returns only requested tails', async () => {
  const input = { symbol: 'BTCUSDT', interval: '1m', tail: 1, options: { strategy: 'buy-hold', initialCapital: 10000, feeBps: 10, slippageBps: 5 } };
  const result = await service().run('backtest', input);
  const quantity = 10000 / (bars[1].open * 1.0005 * 1.001);
  near(result.metrics.finalEquity, quantity * bars[38].close * .9995 * .999);
  assert.equal(result.metrics.tradeCount, 1); assert.equal(result.trades[0].entryTimestamp, bars[1].timestamp);
  assert.equal(result.trades[0].exitTimestamp, bars[38].timestamp); assert.equal(result.trades[0].forcedExit, true);
  assert.equal(result.data.closedOnly, true); assert.equal(result.equity.length, 1); assert.equal(result.equityCount, 39);
  const full = await service().run('backtest', { ...input, tail: 1000 });
  assert.deepEqual(result.metrics, full.metrics); assert.equal(full.equity.length, 39);
  assert.match(formatResearchNote(result), /buy-hold/); assert.match(formatResearchNote(result), /10 bp/);
});

test('All built-in backtest strategies run through the worker', async () => {
  for (const strategy of ['ema-cross', 'rsi']) {
    const result = await service().run('backtest', { symbol: 'AAPL', options: { strategy } });
    assert.equal(result.ok, true); assert.equal(result.options.strategy, strategy);
    assert.equal(result.equityCount, 39); assert.ok(Number.isFinite(result.metrics.finalEquity));
  }
});

test('Research bounds and arbitrary code are rejected before any data fetch', async () => {
  let fetched = 0;
  const s = service(undefined, { candles: async () => { fetched++; return fixture(); } });
  for (const input of [
    { symbol: 'BTCUSDT', code: 'process.exit()' }, { symbol: 'https://example.com' },
    { symbol: 'BTCUSDT', limit: 5001 }, { symbol: 'BTCUSDT', tail: 1001 },
    { symbol: 'BTCUSDT', indicators: Array(9).fill({ type: 'SMA' }) },
    { symbol: 'BTCUSDT', indicators: [{ type: 'SMA', period: -1 }] },
    { symbol: 'BTCUSDT', indicators: [{ type: 'MACD', fast: 30, slow: 10 }] },
    { symbol: 'BTCUSDT', indicators: [{ type: 'BB', multiplier: Infinity }] },
  ]) await assert.rejects(s.run('indicators', input), { code: 'INVALID_RESEARCH_INPUT', status: 400 });
  await assert.rejects(s.run('backtest', { symbol: 'BTCUSDT', closedOnly: false }), { code: 'INVALID_RESEARCH_INPUT' });
  await assert.rejects(s.run('backtest', { symbol: 'BTCUSDT', options: { fast: 50, slow: 10 } }), { code: 'INVALID_RESEARCH_INPUT' });
  await assert.rejects(s.run('pine', { symbol: 'BTCUSDT' }), { code: 'INVALID_RESEARCH_KIND' });
  assert.equal(fetched, 0);
});

test('Insufficient history and upstream failure release a calculation slot', async () => {
  const s = service(fixture(bars.slice(0, 1)));
  await assert.rejects(s.run('backtest', { symbol: 'BTCUSDT' }), { code: 'INSUFFICIENT_RESEARCH_DATA' });
  assert.equal(s.active, 0);
  s.candles = async () => { throw new Error('upstream unavailable'); };
  await assert.rejects(s.run('indicators', { symbol: 'BTCUSDT' }), /upstream unavailable/);
  assert.equal(s.active, 0);
});

test('Concurrency is bounded before fetching; a completed job releases the slot', async () => {
  let release, calls = 0;
  const s = service(undefined, { maxConcurrent: 1, candles: async () => { calls++; return fixture(); },
    execute: () => new Promise(resolve => { release = resolve; }) });
  const first = s.run('indicators', { symbol: 'BTCUSDT' });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(s.run('backtest', { symbol: 'ETHUSDT' }), { code: 'RESEARCH_BUSY', status: 429 });
  assert.equal(calls, 1);
  release({ warnings: [] }); await first; assert.equal(s.active, 0);
});

test('A stalled worker is terminated by the wall clock limit', async () => {
  await assert.rejects(executeResearch({}, { timeoutMs: 100, workerURL: new URL('data:text/javascript,setInterval(() => {}, 1000)') }), { code: 'RESEARCH_TIMEOUT', status: 504 });
});

test('A worker that exits without results returns a controlled error', async () => {
  await assert.rejects(executeResearch({}, { workerURL: new URL('data:text/javascript,process.exit(0)') }), { code: 'RESEARCH_WORKER_EXIT' });
});

test('Default scope excludes domestic futures and rejects their data requests, while other markets remain', async () => {
  const scope = createMarketScope();
  const length = scope.catalog().length;
  assert.ok(length >= 250, 'expanded public directory remains available in the default scope');
  assert.equal(new Set(scope.catalog().map(s => s.symbol)).size, length, 'catalog symbols are unique');
  assert.equal(scope.catalog().some(s => s.market === 'cn-futures'), false);
  for (const symbol of ['SINA:RB0', 'TQ:KQ.m@SHFE.rb', 'sina:au0']) assert.throws(() => scope.assertSymbol(symbol), { code: 'MARKET_DISABLED' });
  for (const symbol of ['BTCUSDT', 'AAPL', '0700.HK', '600519.SS', 'EURUSD=X', 'GC=F', '^GSPC']) assert.doesNotThrow(() => scope.assertSymbol(symbol));
  assert.deepEqual((await scope.search('SINA:RB0')).results, []);
  assert.deepEqual((await scope.search('TQ:')).results, []);
  assert.equal((await scope.search('')).results.length, length);
});

test('Optional legacy adapters remain usable only when explicitly enabled', async () => {
  const scope = createMarketScope({ domesticFutures: true });
  assert.equal(scope.catalog().length, scope.catalog().filter(s => s.provider !== 'sina').length + scope.catalog().filter(s => s.provider === 'sina' && s.market === 'cn-futures').length);
  assert.doesNotThrow(() => scope.assertSymbol('SINA:RB0'));
  assert.equal((await scope.search('SINA:RB2701')).results[0].symbol, 'SINA:RB2701');
});
