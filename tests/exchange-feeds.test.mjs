import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { decodeOkxFrame, decodeKrakenFrame, krakenPair, okxInstId, okxSymbol, krakenWsSymbol } from '../server/exchange-feeds.mjs';
import { fetchCandles } from '../server/market-data.mjs';
import { MarketHub, PushSession } from '../server/market-hub.mjs';

const okxFrame = JSON.stringify({
  arg: { channel: 'tickers', instId: 'BTC-USDT' },
  data: [{ instId: 'BTC-USDT', last: '81543.31', lastSz: '0.1', open24h: '80000', high24h: '82000', low24h: '79000', volCcy24h: '12345.6', ts: '1792220000000' }],
});
const krakenFrame = JSON.stringify({
  channel: 'ticker', type: 'update', data: [{ symbol: 'BTC/USD', last: '80100.5', change: '1100.5', changePct: '1.39', volume: '1234.5', open: '79000' }],
});

test('OKX 推送帧转成报价并保留源时间与传输时延，无效帧被丢弃', () => {
  const event = decodeOkxFrame(okxFrame, 1792220000500);
  assert.equal(event.type, 'batch');
  const [quote] = event.events;
  assert.equal(quote.symbol, 'OKX:BTC-USDT');
  assert.equal(quote.quote.price, 81543.31);
  assert.ok(Math.abs(quote.quote.change - 1543.31) < 1e-6);
  assert.ok(Math.abs(quote.quote.changePercent - 1543.31 / 80000 * 100) < 1e-6);
  assert.equal(quote.meta.ageMs, 500);
  assert.equal(quote.meta.feedType, 'push');
  assert.equal(decodeOkxFrame('pong', 1).type, 'keepalive');
  assert.equal(decodeOkxFrame('not json', 1), null);
  assert.equal(decodeOkxFrame(JSON.stringify({ arg: { channel: 'tickers' }, data: [{ instId: 'BTC-USDT', last: '', ts: '1' }] }), 1), null);
});

test('Kraken v2 推送帧转换并以接收时间为 sourceTime 标注口径', () => {
  const event = decodeKrakenFrame(krakenFrame, 1792220000100);
  const [quote] = event.events;
  assert.equal(quote.symbol, 'KRAKEN:BTC/USD');
  assert.equal(quote.quote.price, 80100.5);
  assert.equal(quote.quote.changePercent, 1.39);
  assert.equal(quote.meta.sourceTime, 1792220000100);
  assert.ok(quote.meta.sourceTimeNote.includes('接收时间'));
  assert.equal(decodeKrakenFrame(JSON.stringify({ method: 'heartbeat' }), 1).type, 'keepalive');
  assert.equal(decodeKrakenFrame('bad', 1), null);
});

test('交易所符号与 REST 路由约定', async () => {
  assert.equal(okxInstId('OKX:BTC-USDT'), 'BTC-USDT');
  assert.equal(okxSymbol('BTC-USDT'), 'OKX:BTC-USDT');
  assert.equal(krakenPair('KRAKEN:XBT/USD'), 'XBTUSD');
  assert.equal(krakenPair('KRAKEN:ETH/USD'), 'ETHUSD');
  assert.equal(krakenWsSymbol('KRAKEN:XBT/USD'), 'BTC/USD');
  await assert.rejects(() => fetchCandles({ symbol: 'OKX:BTC-USDT', interval: '2h' }), error => error.code === 'INVALID_INTERVAL');
  await assert.rejects(() => fetchCandles({ symbol: 'KRAKEN:BTC/USD', interval: '2h' }), error => error.code === 'INVALID_INTERVAL');
});

class Socket extends EventEmitter {
  constructor(){super();this.readyState=0;this.sent=[];}
  send(raw){this.sent.push(raw);}
  open(){this.readyState=1;this.emit('open');}
  close(){this.readyState=3;this.emit('close');}
  terminate(){this.close();}
}

test('后台提醒需求在没有页面客户端时也生成订阅流，客户端断开后仍保留', () => {
  const sockets=[];
  const hub=new MarketHub({socketFactory:url=>{const socket=new Socket();socket._url=url;sockets.push(socket);return socket;},publicQuotes:async()=>[]});
  try{
    hub.setBackgroundSymbols(['BTCUSDT','OKX:SUI-USDT','../secret','not a symbol']);
    assert.deepEqual([...hub.wanted().symbols].sort(),['BTCUSDT','OKX:SUI-USDT']);
    hub.reconcile();
    const binance=sockets.find(s=>s._url==='wss://data-stream.binance.vision:443/ws');
    assert.ok(binance,'binance 会话建立');
    binance.open();
    assert.deepEqual(JSON.parse(binance.sent[0]).params,['btcusdt@ticker']);
    assert.deepEqual(hub.snapshot().background.symbols,['BTCUSDT','OKX:SUI-USDT']);
    // 取消后台需求后会话状态回落、订阅解除。
    hub.setBackgroundSymbols(['BTCUSDT','OKX:SUI-USDT']);
    assert.equal(hub.snapshot().background.symbols.length,2);
    hub.setBackgroundSymbols([]);
    assert.equal(hub.snapshot().background.symbols.length,0);
  }finally{hub.close();}
});

test('PushSession 增量订阅 OKX tickers 频道，取消需求即断开', () => {
  const sockets=[];
  const frames=[];
  const session=new PushSession({
    name:'okx-ws',url:'wss://fake.test/ws/v5/public',socketFactory:url=>{const s=new Socket();s._url=url;sockets.push(s);return s;},
    buildSub:ids=>({op:'subscribe',args:ids.map(instId=>({channel:'tickers',instId}))}),
    buildUnsub:ids=>({op:'unsubscribe',args:ids.map(instId=>({channel:'tickers',instId}))}),
    decode:decodeOkxFrame,
    onStatus:()=>{},
    onEvent:batch=>frames.push(...batch.events),
  });
  try{
    session.reconcile(['SUI-USDT','BTC-USDT']);
    const socket=sockets.at(-1);
    socket.open();
    const opening=JSON.parse(socket.sent[0]);
    assert.deepEqual(opening.args,[{channel:'tickers',instId:'SUI-USDT'},{channel:'tickers',instId:'BTC-USDT'}]);
    socket.emit('message',okxFrame);
    assert.equal(frames[0].symbol,'OKX:BTC-USDT');
    session.lastControl=0; // 跳过 600ms 节流（与 binance 会话同一语义）
    session.reconcile(['BTC-USDT']);
    const unsub=JSON.parse(socket.sent.at(-1));
    assert.deepEqual(unsub.args,[{channel:'tickers',instId:'SUI-USDT'}]);
    session.reconcile([]);
    assert.equal(socket.readyState,3,'无需求即断开');
  }finally{session.close();}
});


import { parseSinaQuotes, easternOffsetMinutes, parseUsMarkerTimestamp, sinaCode } from '../server/public-feeds.mjs';

test('新浪美股 gb_ 报价解析：昨收/涨跌额/美东报价时间戳', () => {
  const text='var hq_str_gb_aapl="苹果,343.4600,0.43,2026-10-17 07:59:51,1.4600,346.0850,347.8200,340.4600,348.1500,242.8900,59946368,36020239,5012517063143,8.30,41.38,0.00,0.00,0.00,0.00,14594180001,63,342.8120,-0.19,-0.65,Oct 16 07:59PM EDT,Oct 16 04:00PM EDT,342.0000,7617902,1,2026,20629491159.0000,343.8499,290.6200,2616346768.8078,343.4600,342.0000";';
  const [q]=parseSinaQuotes(text,['AAPL'],Date.parse('2026-10-17T01:00:00Z'));
  assert.equal(q.quote.price,343.46);
  assert.equal(q.quote.change,1.46);
  assert.equal(q.quote.changePercent,0.43);
  assert.equal(q.quote.previousClose,342.0);
  assert.equal(q.quote.open,346.085);
  assert.equal(q.quote.high,347.82);
  assert.equal(q.quote.low,340.46);
  assert.equal(q.quote.volume,59946368);
  assert.equal(q.quote.timestamp,parseUsMarkerTimestamp('Oct 16 07:59PM EDT'));
  assert.equal(sinaCode('NVDA'),'gb_nvda');
});

test('新浪国际期货 hf_ 报价解析：昨结口径与市场时区秒级时间', () => {
  const text='var hq_str_hf_GC="4184.855,,4186.500,4187.100,4220.400,4167.500,04:59:56,4170.100,4192.100,0,1,1,2026-10-17,纽约黄金,0";';
  const [q]=parseSinaQuotes(text,['GC=F'],Date.parse('2026-10-17T12:00:00Z'));
  assert.equal(q.quote.price,4184.855);
  assert.equal(q.quote.high,4220.4);
  assert.equal(q.quote.low,4167.5);
  assert.equal(q.quote.open,4192.1);
  assert.equal(q.quote.previousClose,4170.1,'昨结口径');
  const expected=Date.UTC(2026,9,17,8,59,56); // 04:59:56 EDT = 08:59:56 UTC
  assert.equal(q.quote.timestamp,expected,'美东 04:59:56 转 UTC');
  assert.equal(q.quote.changeReference,'previous-settlement');
  assert.ok(q.quote.volume===null);
});

test('新浪 int_ 全球指数解析：无源时间戳以本机请求时间标记', () => {
  const text='var hq_str_int_sp500="标普指数,6643.70,38.98,0.59";';
  const now=Date.parse('2026-10-17T12:30:00Z');
  const [q]=parseSinaQuotes(text,['^GSPC'],now);
  assert.equal(q.quote.price,6643.7);
  assert.equal(q.quote.change,38.98);
  assert.equal(q.quote.changePercent,0.59);
  assert.equal(q.quote.timestamp,now);
  assert.equal(q.quote.changeReference,'previous-close-marked-at-fetch');
});
