import WebSocket from 'ws';
import { fetchPublicQuotes, sinaCode } from './public-feeds.mjs';
import { fetchCandles, SUPPORTED_INTERVALS } from './market-data.mjs';
import { isOkxSymbol, isKrakenSymbol, isExchangeSymbol, okxInstId, krakenWsSymbol, decodeOkxFrame, decodeKrakenFrame, publicWsSocket } from './exchange-feeds.mjs';
import { isBinPerpSymbol, fetchBinPerpTicker } from './binance-perp.mjs';

export const isCrypto = s => /^[A-Z0-9]{1,24}(?:USDT|USDC|FDUSD)$/.test(s);
export const QUOTE_POLL_MS = 3000;
const finite = n => n!==''&&n!==null&&n!==undefined&&Number.isFinite(Number(n));
export function decodeBinanceEvent(raw,receivedAt=Date.now()){
  let data;try{data=typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
  data=data?.data||data;if(!data||!finite(data.E)||!isCrypto(data.s||''))return null;
  const meta={provider:'binance-ws',providerName:'Binance 官方 WebSocket',sourceUrl:'wss://data-stream.binance.vision:443',feedType:'push',delayMinutes:0,sourceTime:Number(data.E),receivedAt,ageMs:Math.max(0,receivedAt-Number(data.E))};
  if(data.e==='kline'){
    const k=data.k;if(!k||!SUPPORTED_INTERVALS.includes(k.i)||![k.t,k.T,k.o,k.h,k.l,k.c,k.v].every(finite))return null;
    const candle={timestamp:Number(k.t),closeTime:Number(k.T),open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v),closed:k.x===true};
    if(candle.high<Math.max(candle.open,candle.close)||candle.low>Math.min(candle.open,candle.close)||candle.low>candle.high||candle.volume<0)return null;
    return {type:'candle',symbol:data.s,interval:k.i,candle,meta};
  }
  if(data.e==='24hrTicker'&&[data.c,data.p,data.P,data.x,data.v].every(finite))return {type:'quote',symbol:data.s,quote:{price:Number(data.c),change:Number(data.p),changePercent:Number(data.P),previousClose:Number(data.x),timestamp:Number(data.E),volume:Number(data.v),changePeriod:'rolling-24h'},meta};
  return null;
}

// OKX / Kraken 公共 WebSocket 会话：与 Binance 会话同一套「增量订阅、断线退避、stale 自检」语义。
// 导出供单测注入假 Socket 驱动（真实 socketFactory 由 MarketHub 注入 publicWsSocket）。
export class PushSession {
  constructor({name,url,socketFactory,buildSub,buildUnsub,decode,onEvent,onStatus,openExtra=[],ping=null,staleMs=45000}={}){
    this.name=name;this.url=url;this.socketFactory=socketFactory;this.buildSub=buildSub;this.buildUnsub=buildUnsub;
    this.decode=decode;this.onEvent=onEvent;this.onStatus=onStatus;this.openExtra=openExtra;this.ping=ping;this.staleMs=staleMs;
    this.sent=new Set();this.attempt=0;this.retryAt=0;this.ws=null;this.lastFrame=0;this.lastControl=0;this.sequence=0;
    this.closed=false;this.phase='idle';this.pingTimer=null;
  }
  emit(status,message){this.phase=status;this.onStatus(status,message);}
  send(frame){if(!this.ws||this.ws.readyState!==1)return;this.ws.send(typeof frame==='string'?frame:JSON.stringify(frame));this.lastControl=Date.now();}
  reconcile(want){
    const wanted=want instanceof Set?want:new Set(Array.isArray(want)?want:[]);
    if(!wanted.size){if(this.ws){const ws=this.ws;this.ws=null;ws.close();}this.sent.clear();this.phase='idle';return;}
    if(!this.ws){if(this.closed||Date.now()<this.retryAt)return;this.connect(wanted);return;}
    if(this.ws.readyState!==WebSocket.OPEN||Date.now()-(this.lastControl||0)<600)return;
    const remove=[...this.sent].filter(s=>!wanted.has(s)),add=[...wanted].filter(s=>!this.sent.has(s));
    if(remove.length){this.send(this.buildUnsub([...remove]));[...remove].forEach(s=>this.sent.delete(s));}
    else if(add.length){this.send(this.buildSub([...add]));[...add].forEach(s=>this.sent.add(s));}
  }
  connect(wanted){
    if(this.closed)return;
    this.emit(this.attempt?'reconnecting':'connecting');let ws;
    try{ws=this.socketFactory(this.url,this.attempt+1);}catch(error){this.retryAt=Date.now()+3000;this.emit('error',error.message);return;}
    this.ws=ws;this.sequence=0;this.lastFrame=Date.now();
    ws.on('open',()=>{if(this.ws!==ws)return;this.sent.clear();this.attempt=0;this.emit('connected','连接已建立，等待有效行情。');
      for(const frame of this.openExtra)this.send(frame);
      if(this.ping)this.pingTimer=setInterval(()=>{if(this.ws===ws&&ws.readyState===WebSocket.OPEN)this.send(this.ping.frame);},this.ping.intervalMs);
      this.reconcile(wanted);});
    ws.on('message',raw=>{if(this.ws!==ws)return;this.lastFrame=Date.now();
      const decoded=this.decode(String(raw),Date.now());if(!decoded)return;
      if(decoded.type==='keepalive')return;
      if(Array.isArray(decoded.events)&&decoded.events.length){if(this.phase!=='live')this.emit('live');this.onEvent(decoded);}});
    ws.on('error',()=>{});
    ws.on('close',()=>{if(this.pingTimer){clearInterval(this.pingTimer);this.pingTimer=null;}
      if(this.ws!==ws)return;this.ws=null;this.sent.clear();
      this.retryAt=Date.now()+Math.min(30000,1000*2**Math.min(5,this.attempt++));
      if(this.closed)return;this.emit('reconnecting','连接中断，将自动重连。');});
  }
  stale(){if(this.ws&&this.ws.readyState===WebSocket.OPEN&&this.lastFrame&&Date.now()-this.lastFrame>this.staleMs){this.emit('stale',`超过 ${Math.round(this.staleMs/1000)} 秒未收到行情。`);this.ws.terminate();}}
  snapshot(){return {provider:this.name,status:this.phase,subscriptions:this.sent.size,lastFrameAt:this.lastFrame||null};}
  close(){this.closed=true;if(this.pingTimer)clearInterval(this.pingTimer);const ws=this.ws;this.ws=null;ws?.close();this.sent.clear();this.phase='idle';}
}

export class MarketHub {
  constructor({socketFactory=url=>new WebSocket(url),publicQuotes=fetchPublicQuotes,history=fetchCandles,accounts=null,onEvent=null}={}){
    this.accounts=accounts;this.onEvent=onEvent;
    this.socketFactory=socketFactory;this.publicQuotes=publicQuotes;this.history=history;
    this.clients=new Set();this.quotes=new Map();this.lastBars=new Map();this.sent=new Set();this.status='idle';this.attempt=0;this.closed=false;this.yahooAt=new Map();this.perpAt=new Map();this.sinaMiss=new Map();
    this.timer=setInterval(()=>this.tick(),1000);this.timer.unref();this.lastPoll=0;
    this.background=new Set();
    this.okx=new PushSession({name:'okx-ws',url:'wss://ws.okx.com:8443/ws/v5/public',
      socketFactory:(url,attempt)=>publicWsSocket(url,attempt,{onMode:mode=>this.publish({type:'status',provider:'okx-ws',status:'note',message:mode==='proxy-tunnel'?'直连连接被重置，自动改走本机代理隧道（同为 OKX 官方端点，仅换网络出口）。':'直连。',at:Date.now()})}),
      buildSub:ids=>({op:'subscribe',args:ids.map(instId=>({channel:'tickers',instId}))}),
      buildUnsub:ids=>({op:'unsubscribe',args:ids.map(instId=>({channel:'tickers',instId}))}),
      ping:{intervalMs:20000,frame:'ping'},staleMs:45000,decode:decodeOkxFrame,
      onStatus:(status,message)=>this.publish({type:'status',provider:'okx-ws',status,message,at:Date.now()}),
      onEvent:batch=>{for(const event of batch.events)this.publish(event);}});
    this.kraken=new PushSession({name:'kraken-ws',url:'wss://ws.kraken.com/v2',
      socketFactory:(url,attempt)=>publicWsSocket(url,attempt,{onMode:mode=>this.publish({type:'status',provider:'kraken-ws',status:'note',message:mode==='proxy-tunnel'?'直连连接被重置，自动改走本机代理隧道（同为 Kraken 官方端点，仅换网络出口）。':'直连。',at:Date.now()})}),
      buildSub:symbols=>({method:'subscribe',params:{channel:'ticker',symbol:symbols}}),
      buildUnsub:symbols=>({method:'unsubscribe',params:{channel:'ticker',symbol:symbols}}),
      openExtra:[{method:'subscribe',params:{channel:'heartbeat'}}],staleMs:20000,decode:decodeKrakenFrame,
      onStatus:(status,message)=>this.publish({type:'status',provider:'kraken-ws',status,message,at:Date.now()}),
      onEvent:batch=>{for(const event of batch.events)this.publish(event);}});
  }
  // 后台盯盘需求：提醒存在时即使没有浏览器客户端也保持对应行情订阅。
  setBackgroundSymbols(symbols){
    const next=new Set((Array.isArray(symbols)?symbols:[]).map(s=>String(s||'').trim().toUpperCase()).filter(s=>/^(?=.{1,50}$)(?!.*\.\.)[A-Z0-9^][A-Z0-9.@^=:_/-]*$/.test(s)));
    if([...next].sort().join()===[...this.background].sort().join())return false;
    this.background=next;this.reconcile();return true;
  }
  wanted(){const symbols=new Set(),streams=new Set();for(const client of this.clients)for(const r of client.requests){symbols.add(r.symbol);if(isCrypto(r.symbol)){streams.add(`${r.symbol.toLowerCase()}@ticker`);if(r.interval)streams.add(`${r.symbol.toLowerCase()}@kline_${r.interval}`);}}for(const symbol of this.background){symbols.add(symbol);if(isCrypto(symbol))streams.add(`${symbol.toLowerCase()}@ticker`);}return {symbols,streams};}
  subscribe(requests,callback){
    if(!Array.isArray(requests)||!requests.length||requests.length>50)throw Object.assign(new Error('订阅需要 1 至 50 个标的。'),{status:400});
    for(const r of requests)if(!/^[A-Z0-9.@^=:_/-]{1,50}$/i.test(r.symbol)||r.interval&&!SUPPORTED_INTERVALS.includes(r.interval))throw Object.assign(new Error('订阅标的或周期无效。'),{status:400});
    const client={requests,callback};this.clients.add(client);
    for(const {symbol} of requests){const latest=this.quotes.get(symbol);if(latest)callback({...latest,cached:true});}
    this.tick();return()=>{this.clients.delete(client);this.reconcile();};
  }
  publish(event){
    const key=event.type==='candle'?`${event.symbol}|${event.interval}`:event.symbol;
    const map=event.type==='candle'?this.lastBars:this.quotes;
    if(['candle','quote'].includes(event.type)){
      const previous=map.get(key);if(previous&&event.meta.sourceTime<previous.meta.sourceTime)return;
      if(event.type==='candle'&&previous&&(event.candle.timestamp<previous.candle.timestamp||(event.candle.timestamp===previous.candle.timestamp&&previous.candle.closed&&!event.candle.closed)))return;
      map.set(key,event);
    }
    for(const client of this.clients){
      if(event.type==='status'||client.requests.some(r=>r.symbol===event.symbol&&(event.type!=='candle'||r.interval===event.interval)))try{client.callback(event);}catch{/* A closed downstream must not interrupt the shared upstream. */}
    }
    try{this.onEvent?.(event);}catch{/* Alert delivery must not stop the quote fan-out. */}
  }
  connection(status,message){this.status=status;this.publish({type:'status',provider:'binance-ws',status,message,at:Date.now()});}
  reconcile(){
    const {symbols,streams}=this.wanted();
    this.okx.reconcile([...symbols].filter(isOkxSymbol).map(okxInstId));
    this.kraken.reconcile([...symbols].filter(isKrakenSymbol).map(krakenWsSymbol));
    if(!streams.size){if(this.ws){const ws=this.ws;this.ws=null;ws.close();}this.sent.clear();this.status='idle';return;}
    if(!this.ws){if(this.closed||Date.now()<(this.retryAt||0))return;this.connect();return;}
    if(this.ws.readyState!==WebSocket.OPEN||Date.now()-(this.lastControl||0)<600)return;
    const remove=[...this.sent].filter(s=>!streams.has(s)),add=[...streams].filter(s=>!this.sent.has(s));
    if(remove.length){this.ws.send(JSON.stringify({method:'UNSUBSCRIBE',params:remove,id:++this.sequence}));remove.forEach(s=>this.sent.delete(s));this.lastControl=Date.now();}
    else if(add.length){this.ws.send(JSON.stringify({method:'SUBSCRIBE',params:add,id:++this.sequence}));add.forEach(s=>this.sent.add(s));this.lastControl=Date.now();}
  }
  connect(){
    this.connection(this.attempt?'reconnecting':'connecting');let ws;
    try{ws=this.socketFactory('wss://data-stream.binance.vision:443/ws');}catch(error){this.retryAt=Date.now()+3000;this.connection('error',error.message);return;}
    this.ws=ws;this.sequence=0;this.lastControl=0;this.lastFrame=Date.now();
    ws.on('open',()=>{if(this.ws!==ws)return;this.sent.clear();this.attempt=0;this.connection('connected','连接已建立，等待有效行情。');this.reconcile();});
    ws.on('message',raw=>{
      if(this.ws!==ws)return;this.lastFrame=Date.now();let data;try{data=JSON.parse(raw.toString());}catch{return;}
      if(data.code!==undefined){this.connection('error',String(data.msg||'订阅失败'));return;}
      const event=decodeBinanceEvent(data);if(!event)return;
      if(this.status!=='live')this.connection('live');this.publish(event);
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{if(this.ws!==ws)return;this.ws=null;this.sent.clear();this.retryAt=Date.now()+Math.min(30000,1000*2**Math.min(5,this.attempt++));if(!this.closed&&this.wanted().streams.size)this.connection('reconnecting','连接中断，将自动重连并补拉历史。');});
  }
  async tick(){
    if(this.closed)return;this.reconcile();
    this.okx.stale();this.kraken.stale();
    if(this.ws&&Date.now()-this.lastFrame>45000){this.connection('stale','超过 45 秒未收到行情。');this.ws.terminate();}
    // 币安美股永续：fapi 镜像 REST 轮询（本机 fstream WS 不推帧，实测结论），独立 1 秒节奏，不受下方 3 秒门约束。
    for(const symbol of this.wanted().symbols){
      if(!isBinPerpSymbol(symbol))continue;
      if(Date.now()-(this.perpAt.get(symbol)||0)<1000)continue;
      this.perpAt.set(symbol,Date.now());
      try{const q=await fetchBinPerpTicker(symbol);if(q&&q.price)this.publish({type:'quote',symbol,quote:q,meta:{provider:'binance-perp',providerName:'Binance TradFi 永续',sourceUrl:'https://www.binance.com/fapi/v1/ticker/24hr',feedType:'poll',pollIntervalMs:1000,delayMinutes:0,sourceTime:q.timestamp,receivedAt:Date.now()}});}
      catch(error){this.publish({type:'status',provider:'binance-perp',symbol,status:'error',message:error.message,at:Date.now()});}
    }
    if(Date.now()-this.lastPoll<QUOTE_POLL_MS||this.polling)return;this.lastPoll=Date.now();this.polling=true;
    const symbols=[...this.wanted().symbols].filter(s=>!isCrypto(s)&&!isExchangeSymbol(s)&&!isBinPerpSymbol(s)&&!s.startsWith('TQ:'));
    try{
      const supported=symbols.filter(s=>sinaCode(s));
      const sinaHits=[];
      if(supported.length){try{for(const item of await this.publicQuotes(supported)){sinaHits.push(item.symbol);this.publish({type:'quote',...item});}}catch(error){this.publish({type:'status',provider:'sina',status:'error',message:error.message,at:Date.now()});}}
      // 新浪覆盖了代码但没返回数据（如搜索来的冷门美股）：记录为 miss，60 秒后允许该标的回落 Yahoo 轮询。
      for(const symbol of supported){if(sinaHits.includes(symbol))this.sinaMiss.delete(symbol);else if(!this.sinaMiss.has(symbol))this.sinaMiss.set(symbol,Date.now());}
      const sinaFallback=supported.filter(s=>this.sinaMiss.has(s)&&Date.now()-this.sinaMiss.get(s)>=60000);
      const others=[...symbols.filter(s=>!sinaCode(s)),...sinaFallback].filter(s=>Date.now()-(this.yahooAt.get(s)||0)>=QUOTE_POLL_MS).slice(0,4);
      await Promise.allSettled(others.map(async symbol=>{this.yahooAt.set(symbol,Date.now());try{const p=await this.history({symbol,interval:'1m',limit:2});this.publish({type:'quote',symbol,quote:p.quote,meta:{...p.meta,feedType:'poll',pollIntervalMs:QUOTE_POLL_MS,sourceTime:p.quote.timestamp,receivedAt:Date.now()}});}catch(error){this.publish({type:'status',provider:'yahoo',symbol,status:'error',message:error.message,at:Date.now()});}}));
    }finally{this.polling=false;}
  }
  snapshot(){return {binance:{status:this.status,subscriptions:this.sent.size,lastFrameAt:this.lastFrame||null},
    feeds:{okx:this.okx.snapshot(),kraken:this.kraken.snapshot()},
    background:{symbols:[...this.background].sort(),clients:this.clients.size,lastCheckAt:this.lastPoll||null},
    account:this.accounts?{provider:'tqsdk',state:this.accounts.state,lastSourceTime:this.accounts.lastSourceTime||null}:null,clients:this.clients.size,quotes:[...this.quotes.values()].map(e=>({...e,ageMs:Math.max(0,Date.now()-e.quote.timestamp)})),at:Date.now()};}
  async quote(symbol,waitMs=8000){
    const startedAt=Date.now();return new Promise(resolve=>{let release,timer,done=false;const finish=event=>{if(done)return;done=true;clearTimeout(timer);release?.();const ageMs=event?Math.max(0,Date.now()-event.quote.timestamp):null,accountState=symbol.startsWith('TQ:')?this.accounts?.state:null;resolve(event?{...event,ageMs,fresh:ageMs<=15000&&event.quote.timestamp<=Date.now()+5000&&(!accountState||accountState==='connected'),...(accountState?{connectionState:accountState}:{}),cached:event.meta.receivedAt<startedAt}:{symbol,available:false,error:'等待期间未收到有效报价。'});};
      release=this.subscribe([{symbol}],event=>{if(event.type==='quote'&&event.symbol===symbol&&!event.cached)finish(event);});
      if(done){release();return;}timer=setTimeout(()=>finish(this.quotes.get(symbol)),Math.max(100,Math.min(10000,waitMs)));
    });
  }
  close(){this.closed=true;clearInterval(this.timer);this.okx.close();this.kraken.close();const ws=this.ws;this.ws=null;ws?.terminate();this.clients.clear();}
}
