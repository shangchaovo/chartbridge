import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseSinaQuotes,parseJsonp,sinaCode,fetchPublicQuotes } from '../server/public-feeds.mjs';
import { MarketHub,decodeBinanceEvent } from '../server/market-hub.mjs';
test('public commodity futures and A shares retain source date/time and previous settlement/close',()=>{
  const text='var hq_str_nf_RB0="螺纹钢连续,145544,3073,3084,3053,0,3069,3070,3069,0,3076,863,780,1734324,752165,沪,螺纹钢,2026-10-15";\nvar hq_str_sh600519="贵州茅台,1286,1286,1314,1318,1282,1314,1315,5567622,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-10-15,14:56:02,00";';
  const [future,stock]=parseSinaQuotes(text,['SINA:RB0','600519.SS'],Date.parse('2026-10-15T06:56:03Z'));
  assert.equal(future.quote.price,3069);assert.equal(future.quote.change,-7);assert.equal(future.quote.changeReference,'previous-settlement');assert.equal(future.quote.timestamp,Date.parse('2026-10-15T06:55:44Z'));
  assert.equal(stock.meta.ageMs,1000);assert.equal(stock.quote.price,1314);assert.equal(future.meta.delayVerified,false);assert.equal(future.meta.feedType,'poll');
  assert.equal(sinaCode('0700.HK'),'rt_hk00700');assert.equal(parseSinaQuotes('var hq_str_nf_RB0="";',['SINA:RB0']).length,0);
});
test('JSONP is parsed without evaluating any JavaScript',()=>{
  assert.deepEqual(parseJsonp('/* wrapper */\n=([{"d":"2026-10-15","c":"3"}]);'),[{d:'2026-10-15',c:'3'}]);
  assert.throws(()=>parseJsonp('eval("anything")'));assert.throws(()=>parseJsonp('=([process.exit()]);'));
});
test('batch quote URL keeps list last so Sina does not treat trailing parameters as a symbol suffix',async()=>{
  const fetchMock=mock.method(globalThis,'fetch',async url=>{
    assert.match(url,/\/rn=\d+&list=nf_RB0,nf_AU0$/);
    const row=(code,price)=>`var hq_str_nf_${code}="${code},145544,3073,3084,3053,0,3069,3070,${price},0,3076,863,780,1734324,752165,SH,RB,2026-10-15";`;
    return new Response(row('RB0',3069)+'\n'+row('AU0',3070));
  });
  try{const result=await fetchPublicQuotes(['SINA:RB0','SINA:AU0']);assert.equal(result.length,2);assert.deepEqual(result.map(r=>r.symbol),['SINA:RB0','SINA:AU0']);}finally{fetchMock.mock.restore();}
});
const event={e:'kline',s:'BTCUSDT',E:2000,k:{i:'1m',t:1000,T:60999,o:'100',h:'105',l:'99',c:'102',v:'8',x:false}};
test('official stream records carry bar closure and measured transport age',()=>{
  const e=decodeBinanceEvent(event,2123);assert.equal(e.meta.ageMs,123);assert.equal(e.candle.closed,false);assert.equal(e.candle.closeTime,60999);
  assert.equal(decodeBinanceEvent({...event,k:{...event.k,c:'200'}}),null);assert.equal(decodeBinanceEvent('not json'),null);
});
class Socket extends EventEmitter{constructor(){super();this.readyState=0;this.sent=[];}send(raw){this.sent.push(JSON.parse(raw));}open(){this.readyState=1;this.emit('open');}close(){this.readyState=3;this.emit('close');}terminate(){this.close();}}
test('upstream subscriptions are shared, out-of-order frames are rejected, disconnect reconnects',()=>{
  const sockets=[],hub=new MarketHub({socketFactory:()=>{const socket=new Socket();sockets.push(socket);return socket;},publicQuotes:async()=>[]});const frames=[];
  const a=hub.subscribe([{symbol:'BTCUSDT',interval:'1m'}],e=>frames.push(e));const b=hub.subscribe([{symbol:'BTCUSDT',interval:'1m'}],()=>{});
  try{
    assert.equal(sockets.length,1);sockets[0].open();assert.deepEqual(sockets[0].sent[0].params,['btcusdt@ticker','btcusdt@kline_1m']);
    sockets[0].emit('message',JSON.stringify(event));sockets[0].emit('message',JSON.stringify({...event,E:1000}));assert.equal(frames.filter(e=>e.type==='candle').length,1);
    sockets[0].close();assert.equal(hub.status,'reconnecting');hub.retryAt=0;hub.reconcile();assert.equal(sockets.length,2);
    sockets[1].open();assert.equal(sockets[1].sent[0].params.length,2);a();assert.equal(hub.clients.size,1);b();assert.equal(hub.status,'idle');
  }finally{hub.close();}
});
