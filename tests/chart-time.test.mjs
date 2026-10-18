import test from 'node:test';
import assert from 'node:assert/strict';
import { barCountdown, formatCountdown, registerCountdownOverlay } from '../src/bar-countdown.js';
import { chartDateTime, chartTimezone, findChartBar, timezoneLabel } from '../src/chart-time.js';
import { normalizeChartPreferences, loadChartPreferences } from '../src/chart-preferences.js';

const start=Date.parse('2026-10-18T00:00:00Z');
const bar={timestamp:start,open:100,close:101};
const args={bar,interval:'5m',now:start+61_000,continuous:true};
test('countdown uses the bar deadline, advances each second and never invents a new bar',()=>{
  assert.equal(barCountdown(args).text,'03:59');
  assert.equal(barCountdown({...args,now:args.now+1000}).text,'03:58');
  assert.equal(barCountdown({...args,now:start+299_999}).text,'00:01');
  assert.equal(barCountdown({...args,now:start+300_000}).reason,'closed');
  assert.equal(barCountdown({...args,now:start+600_000}).visible,false);
  assert.equal(barCountdown({...args,bar:{...bar,timestamp:start+300_000},now:start+300_001}).text,'05:00');
});
test('exchange closeTime wins over duration; inclusive final millisecond is honored',()=>{
  const result=barCountdown({...args,bar:{...bar,closeTime:start+119_999}});
  assert.equal(result.deadline,start+120_000);assert.equal(result.text,'00:59');
  assert.equal(barCountdown({...args,bar:{...bar,closed:true}}).reason,'closed');
});
test('day and week countdowns follow the actual UTC candle start across weekends',()=>{
  assert.equal(barCountdown({...args,interval:'1d',now:start+3600_000}).text,'23:00:00');
  const monday=Date.parse('2026-10-12T00:00:00Z');
  assert.equal(barCountdown({...args,bar:{...bar,timestamp:monday},interval:'1w',now:monday+3600_000}).text,'6d 23:00:00');
  assert.equal(formatCountdown(59_001),'01:00');assert.equal(formatCountdown(NaN),'');
});
test('disabled, replay, imported, stale and paused data do not show a live countdown',()=>{
  for(const [override,reason]of [[{enabled:false},'disabled'],[{replay:true},'replay'],[{imported:true},'imported'],[{paused:true},'paused'],[{meta:{provider:'csv'}},'imported'],[{meta:{cache:'stale'}},'stale']])assert.equal(barCountdown({...args,...override}).reason,reason);
  assert.equal(barCountdown({...args,now:start-1}).reason,'future');
  assert.equal(barCountdown({...args,interval:'range'}).visible,false);
});
test('delayed quotes only show countdowns on intervals strictly larger than their delay',()=>{
  assert.equal(barCountdown({...args,meta:{delayMinutes:5}}).reason,'delayed');
  assert.equal(barCountdown({...args,interval:'15m',meta:{delayMinutes:15}}).reason,'delayed');
  assert.equal(barCountdown({...args,interval:'30m',meta:{delayMinutes:15}}).visible,true);
});
test('session end clips an intraday bar; daily candles use the known session, not 24 hours',()=>{
  const currentSession={start,end:start+3*3600_000};
  const input={...args,continuous:false,meta:{currentSession},now:start+3600_000};
  assert.equal(barCountdown({...input,interval:'1d'}).text,'02:00:00');
  assert.equal(barCountdown({...input,interval:'4h'}).deadline,currentSession.end);
  assert.equal(barCountdown({...input,interval:'4h',now:currentSession.end}).reason,'market-closed');
  assert.equal(barCountdown({...input,interval:'1w'}).reason,'unknown-session');
  assert.equal(barCountdown({...args,interval:'1d',continuous:false}).reason,'unknown-session');
  assert.equal(barCountdown({...input,interval:'1d',bar:{...bar,timestamp:start-86_400_000}}).visible,false);
});
test('countdown overlay produces a non-interactive axis figure that fits at the bottom',()=>{
  let definition;registerCountdownOverlay(value=>definition=value);
  const figure=definition.createYAxisFigures({overlay:{points:[{value:100}],extendData:{text:'03:59',color:'#089981'}},bounding:{width:70,height:200},yAxis:{isFromZero:()=>true,convertToNicePixel:()=>195}})[0];
  assert.equal(figure.ignoreEvent,true);assert.equal(figure.attrs.text,'03:59');assert.ok(figure.attrs.y+18<200);assert.deepEqual(definition.createPointFigures(),[]);
});
test('chart zones support exchange fallback, fractional offsets and daylight saving',()=>{
  assert.equal(chartTimezone('exchange','America/New_York'),'America/New_York');
  assert.equal(chartTimezone('exchange','invalid'),'UTC');
  assert.equal(chartTimezone('invalid'),'Asia/Shanghai');
  assert.match(timezoneLabel('Asia/Kolkata',start),/UTC\+5:30/);
  assert.equal(chartDateTime(Date.parse('2026-07-01T14:00:00Z'),'America/New_York'),'2026-07-01T10:00');
  assert.equal(chartDateTime(Date.parse('2026-12-01T14:00:00Z'),'America/New_York'),'2026-12-01T09:00');
});
test('go to date finds actual bars, the next session after a gap, and rejects unavailable history',()=>{
  const bars=['2026-10-16T13:30Z','2026-10-16T14:30Z','2026-10-19T13:30Z'].map(time=>({timestamp:Date.parse(time)}));
  assert.equal(findChartBar(bars,'2026-10-16T09:30','America/New_York'),0);
  assert.equal(findChartBar(bars,'2026-10-17T12:00','America/New_York'),2);
  assert.equal(findChartBar(bars,'2026-09-01T00:00','America/New_York'),null);
  assert.equal(findChartBar(bars,'2026-10-20T00:00','America/New_York'),null);
  assert.equal(findChartBar(bars,'bad','UTC'),null);
  const fold=['2026-11-01T05:30Z','2026-11-01T06:30Z'].map(time=>({timestamp:Date.parse(time)}));
  assert.equal(findChartBar(fold,'2026-11-01T01:30','America/New_York'),0);
  const reversed=['2026-11-01T05:50Z','2026-11-01T06:10Z'].map(time=>({timestamp:Date.parse(time)}));
  assert.equal(findChartBar(reversed,'2026-11-01T01:30','America/New_York'),0);
});
test('old preferences migrate safely, custom valid timezones persist and malformed values fall back',()=>{
  const migrated=normalizeChartPreferences({lastPrice:false});assert.equal(migrated.countdown,true);assert.equal(migrated.lastPrice,false);assert.equal(migrated.lastPriceLine,true);
  assert.equal(normalizeChartPreferences({timezone:'America/Toronto'}).timezone,'America/Toronto');
  assert.equal(normalizeChartPreferences({timezone:'invalid',countdown:'false'}).countdown,true);
  assert.equal(loadChartPreferences({getItem:()=>'{bad'}).timezone,'Asia/Shanghai');
});
