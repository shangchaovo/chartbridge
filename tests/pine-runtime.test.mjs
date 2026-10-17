import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPineRequests } from '../src/pine-data.js';
import { runPineScript } from '../src/pine-runtime.js';

const start = Date.UTC(2026, 0, 1);
const candlesFor = (values) => values.map((close, index) => ({
  timestamp: start + index * 60_000, open: close - 0.25,
  high: close + 1, low: close - 1, close, volume: 1000 + index,
}));
const candles = candlesFor([1, 2, 3, 2, 4, 5, 4, 6]);
const run = (code, options = {}) => runPineScript({ code, candles, symbol: 'TEST', interval: '1m', ...options });
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

for (const version of [5, 6]) {
  test(`native Pine v${version}: SMA, EMA, RSI calculate from the supplied OHLCV`, async () => {
    const result = await run(`//@version=${version}
indicator("Golden calculations", overlay=false)
plot(ta.sma(close, 3), "SMA", color.blue)
plot(ta.ema(close, 3), "EMA", color.orange, linewidth=2)
plot(ta.rsi(close, 3), "RSI", color.red)
`);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.indicator.version, version);
    assert.equal(result.plots.length, 3);
    const byTitle = Object.fromEntries(result.plots.map((plot) => [plot.title, plot]));
    assert.deepEqual(byTitle.SMA.data.slice(0, 3).map((point) => point.value), [null, null, 2]);
    near(byTitle.SMA.data[3].value, 7 / 3);
    // PineTS 0.11.1 seeds EMA with an SMA; this checks that explicit local behavior.
    near(byTitle.EMA.data[2].value, 2);
    near(byTitle.EMA.data[4].value, 3);
    near(byTitle.RSI.data[3].value, 200 / 3);
    near(byTitle.RSI.data[4].value, 250 / 3);
    assert.equal(byTitle.EMA.width, 2);
    assert.equal(byTitle.EMA.data[0].time, start);
    assert.ok(result.warnings.some((warning) => warning.includes('实验')));
  });
}

test('Pine plotshape produces only active signal markers', async () => {
  const result = await run(`//@version=6
indicator("Signals", overlay=true)
plot(close, "Close")
plotshape(bar_index == 2, title="Buy", style=shape.triangleup, location=location.belowbar, color=color.green, text="BUY")
`);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].time, candles[2].timestamp);
  assert.equal(result.markers[0].text, 'BUY');
  assert.equal(result.markers[0].position, 'belowBar');
  assert.equal(result.markers[0].shape, 'arrowUp');
  assert.equal(result.plots[0].overlay, true);
});

test('Pine histogram and horizontal level remain distinct drawable series', async () => {
  const result = await run(`//@version=6
indicator("Histogram")
plot(close-open, "Change", style=plot.style_histogram)
hline(0, "Zero")
`);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.plots.find((plot) => plot.title === 'Change').type, 'histogram');
  assert.ok(result.plots.find((plot) => plot.title === 'Zero').data.every((point) => point.value === 0));
});

test('same-symbol same-timeframe request.security uses current candles', async () => {
  const result = await run(`//@version=6
indicator("Same series")
plot(request.security(syminfo.tickerid, timeframe.period, close), "Security")
`);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(result.plots[0].data.map((point) => point.value), candles.map((bar) => bar.close));
});

for (const request of ['request.security("TEST", "60", close)', 'request.security("OTHER", "1", close)']) {
  test(`missing secondary data is rejected: ${request}`, async () => {
    const result = await run(`//@version=6\nindicator("Missing data")\nplot(${request})`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'DATA_UNAVAILABLE');
    assert.ok(result.error.message.includes('缺少'));
    assert.deepEqual(result.plots, []);
  });
}

test('an exchange prefix cannot alias a different market to the current ticker', async () => {
  const result = await run('//@version=6\nindicator("Market")\nplot(request.security("NYSE:TEST", "1", close))', { symbol: 'NASDAQ:TEST' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DATA_UNAVAILABLE');
});

test('dynamic request symbols are explicitly outside the local data boundary', async () => {
  const result = await run('//@version=6\nindicator("Dynamic")\nsym = "OTHER"\nplot(request.security(sym, "1", close))');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DYNAMIC_SYMBOL_UNSUPPORTED');
});

test('native Pine strategy places and closes a trade through the real PineTS engine', async () => {
  const result = await run(`//@version=6
strategy("Native strategy", initial_capital=10000, overlay=false)
if bar_index == 1
    strategy.entry("Long", strategy.long, qty=1)
if bar_index == 3
    strategy.close("Long")
plot(strategy.equity, "Equity")
`, { candles: candlesFor([10, 12, 15, 16, 20, 22]) });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.indicator.kind, 'strategy');
  assert.equal(result.strategy.experimental, true);
  assert.equal(result.strategy.closedTradeCount, 1);
  near(result.strategy.netProfit, 5);
  assert.ok(result.warnings.some((warning) => warning.includes('OCA')));
});

test('invalid or unsupported scripts return actionable errors', async () => {
  const old = await run('//@version=4\nstudy("Old")\nplot(close)');
  assert.equal(old.error.code, 'UNSUPPORTED_VERSION');
  const broken = await run('//@version=6\nindicator("Bad")\nplot(');
  assert.equal(broken.ok, false);
  assert.equal(broken.error.code, 'PINE_SYNTAX');
  assert.ok(broken.error.details);
  const unsupported = await run('//@version=6\nindicator("Bad")\nplot(ta.function_not_supported(close))');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, 'PINE_UNSUPPORTED');
});

test('native-only input rejects JavaScript host calls before engine execution', async () => {
  const result = await run('//@version=6\nindicator("Host")\nplot(globalThis.fetch("https://example.com"))');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NATIVE_PINE_ONLY');
});

test('input validation prevents wrong candle order and malformed OHLCV', async () => {
  const code = '//@version=6\nindicator("Close")\nplot(close)';
  const reversed = await run(code, { candles: [...candles].reverse() });
  assert.equal(reversed.error.code, 'INVALID_CANDLES');
  const invalid = await run(code, { candles: [{ ...candles[0], volume: NaN }] });
  assert.equal(invalid.error.code, 'INVALID_CANDLES');
});

test('Pine loop limit returns a controlled runtime error', async () => {
  const result = await run(`//@version=6
indicator("Loop")
int n = 0
while true
    n += 1
plot(n)
`, { candles: [candles[0]] });
  assert.equal(result.ok, false);
  assert.match(result.error.details, /loop|iteration|limit/i);
});

const multiStart=Date.UTC(2025,0,1);
const multiBars=(n,ms,price)=>Array.from({length:n},(_,i)=>({timestamp:multiStart+i*ms,closeTime:multiStart+(i+1)*ms-1,open:price+i,high:price+i+2,low:price+i-1,close:price+i+1,volume:1}));
const multiCode=expr=>`//@version=6\nindicator("multi")\nplot(${expr}, "result")`;
test('cross-symbol security calculates from independent bars, including a verified exchange alias',async()=>{
  const result=await runPineScript({code:multiCode('request.security("BINANCE:ETHUSDT", "1", close)'),symbol:'BTCUSDT',interval:'1m',candles:multiBars(12,60000,100),datasets:[{symbol:'ETHUSDT',interval:'1m',candles:multiBars(12,60000,200)}]});
  assert.equal(result.ok,true,JSON.stringify(result.error));assert.deepEqual(result.plots[0].data.map(p=>p.value),Array.from({length:12},(_,i)=>201+i));
});
test('higher timeframe values appear only at parent closure and cannot leak future closes',async()=>{
  const options={code:multiCode('request.security(syminfo.tickerid, "5", close)'),symbol:'BTCUSDT',interval:'1m',datasets:[{symbol:'BTCUSDT',interval:'5m',candles:multiBars(3,300000,300)}]};
  const result=await runPineScript({...options,candles:multiBars(12,60000,100)});assert.equal(result.ok,true,JSON.stringify(result.error));
  assert.deepEqual(result.plots[0].data.map(p=>p.value),[null,null,null,null,301,301,301,301,301,302,302,302]);
  const truncated=await runPineScript({...options,candles:multiBars(8,60000,100)});assert.equal(truncated.ok,true);assert.deepEqual(truncated.plots[0].data,result.plots[0].data.slice(0,8));
});
test('request scanner respects strings, nested expressions, comments and named arguments',()=>{
  const code='//@version=6\nindicator("request.security(ignored)")\n// request.security("BAD", "1", close)\nx = request.security(symbol="BINANCE:ETHUSDT", timeframe="60", expression=ta.sma(close, 2), lookahead=barmerge.lookahead_off)';
  assert.deepEqual(collectPineRequests(code,'BTCUSDT','1m').map(r=>[r.symbol,r.interval]),[['ETHUSDT','1h']]);
  assert.throws(()=>collectPineRequests('request.security("BTCUSDT", "5", close, lookahead=barmerge.lookahead_on)','BTCUSDT','1m'),e=>e.code==='LOOKAHEAD_UNSUPPORTED');
  assert.throws(()=>collectPineRequests('request.security("BTCUSDT", "1", close)','BTCUSDT','1h'),e=>e.code==='LOWER_TIMEFRAME_UNSUPPORTED');
  assert.throws(()=>collectPineRequests('request.security("ETHUSDT", input.timeframe("60"), close)','BTCUSDT','1m'),e=>e.code==='DYNAMIC_TIMEFRAME_UNSUPPORTED');
});
test('cross-timeframe session markets are rejected until their calendars are verified',async()=>{
  const result=await runPineScript({code:multiCode('request.security("AAPL", "60", close)'),symbol:'AAPL',interval:'1m',candles:multiBars(12,60000,100),datasets:[{symbol:'AAPL',interval:'1h',candles:multiBars(3,3600000,300)}]});
  assert.equal(result.ok,false);assert.equal(result.error.code,'REQUEST_CALENDAR_UNVERIFIED');
});
test('ordinary Pine indicators can use the native account namespace without losing its case',async()=>{
  const result=await runPineScript({code:multiCode('close'),symbol:'TQ:KQ.m@SHFE.rb',interval:'1m',candles:multiBars(12,60000,100)});
  assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.plots[0].data.at(-1).value,112);
});
