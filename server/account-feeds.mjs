import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { access,readFile,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export const ACCOUNT_INTERVALS=['1m','5m','15m','30m','1h','1d'];
export const DEFAULT_ACCOUNT_CONFIG={provider:'tqsdk',enabled:false,userEnv:'SHANHAI_TQ_USER',passwordEnv:'SHANHAI_TQ_PASSWORD',symbols:['KQ.m@SHFE.rb'],intervals:['1m','5m','1h','1d'],historyLength:800};
const sourcePattern=/^(?:KQ\.[mi]@)?(?:SHFE|DCE|CZCE|CFFEX|INE|GFEX)\.[A-Za-z]{1,6}\d{0,4}$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const fail=(message,code='ACCOUNT_CONFIG_INVALID',status=400)=>{throw Object.assign(new Error(message),{code,status});};
const messages={CREDENTIALS_MISSING:'未检测到账户凭据，请通过本机启动环境提供。',SDK_NOT_INSTALLED:'账户行情运行环境尚未安装。',CONNECTION_FAILED:'账户行情连接失败，请核对凭据、网络及数据权限。',BRIDGE_EXITED:'账户行情进程已退出，可在本机重新连接。',INVALID_DATA:'账户行情返回了无效数据。'};
export function validateAccountConfig(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('账户配置必须是对象。');
  if(Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_ACCOUNT_CONFIG,key)))fail('配置仅接受非敏感设置；密码请通过本机环境提供。');
  const c={...structuredClone(DEFAULT_ACCOUNT_CONFIG),...input};
  if(c.provider!=='tqsdk'||typeof c.enabled!=='boolean')fail('当前账户适配器为 TqSDK。');
  if(![c.userEnv,c.passwordEnv].every(v=>typeof v==='string'&&/^SHANHAI_TQ_[A-Z0-9_]{1,40}$/.test(v))||c.userEnv===c.passwordEnv)fail('账户与密码需要两个不同的 SHANHAI_TQ_ 环境变量。');
  if(!Array.isArray(c.symbols)||!c.symbols.length||c.symbols.length>8||c.symbols.some(s=>typeof s!=='string'||!sourcePattern.test(s)))fail('请输入 1 至 8 个有效合约，例如 KQ.m@SHFE.rb、SHFE.rb2701。');
  if(!Array.isArray(c.intervals)||!c.intervals.length||c.intervals.some(v=>!ACCOUNT_INTERVALS.includes(v)))fail('账户周期支持 1/5/15/30 分钟、1 小时及日线。');
  if(!Number.isInteger(c.historyLength)||c.historyLength<2||c.historyLength>1000)fail('历史条数需为 2 至 1000。');
  return {...c,symbols:[...new Set(c.symbols)],intervals:[...new Set(c.intervals)]};
}
export class AccountFeeds extends EventEmitter{
  constructor({root,dataDir,env=process.env,spawnChild=spawn,pythonPath}={}){
    super();Object.assign(this,{root,dataDir,env,spawnChild});this.path=join(dataDir,'market-accounts.json');this.python=pythonPath||env.TERMINAL_TQ_PYTHON||join(root,'.venv-tqsdk','bin','python');this.config=structuredClone(DEFAULT_ACCOUNT_CONFIG);this.state='unconfigured';this.bars=new Map();this.quotes=new Map();this.generation=0;this.writeQueue=Promise.resolve();
  }
  async init(){try{this.config=validateAccountConfig(JSON.parse(await readFile(this.path,'utf8')));this.state=this.config.enabled?'disconnected':'disabled';}catch(e){if(e.code!=='ENOENT'){this.state='error';this.error='账户配置文件无效，请在本机重新保存。';}}return this;}
  async status(){let runtimeReady=true;try{await access(this.python);}catch{runtimeReady=false;}
    return {provider:'tqsdk',state:this.state,message:this.error||'',configured:this.config.enabled,credentialsReady:Boolean(this.env[this.config.userEnv]&&this.env[this.config.passwordEnv]),runtimeReady,connected:this.state==='connected',lastReceivedAt:this.lastReceivedAt||null,lastSourceTime:this.lastSourceTime||null,quoteCount:this.quotes.size,seriesCount:this.bars.size};
  }
  catalog(){return this.config.enabled?this.config.symbols.map(s=>({symbol:`TQ:${s}`,name:`天勤 · ${s}`,market:'cn-futures',exchange:s.replace(/^KQ\.[mi]@/,'').split('.')[0],currency:'CNY',type:'futures',provider:'tqsdk'})):[];}
  enqueue(action){const task=this.writeQueue.then(action);this.writeQueue=task.catch(()=>{});return task;}
  async save(value){const config=validateAccountConfig(value);return this.enqueue(async()=>{await this.stop();const temp=`${this.path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(config,null,2),{mode:0o600});await rename(temp,this.path);this.config=config;this.bars.clear();this.quotes.clear();this.lastReceivedAt=null;this.lastSourceTime=null;this.error='';this.state=config.enabled?'disconnected':'disabled';return {config:structuredClone(config),status:await this.status()};});}
  connect(){return this.enqueue(()=>this.start());}
  disconnect(){return this.enqueue(()=>this.stop());}
  async start(){
    if(this.child)return this.status();if(!this.config.enabled)fail('请先保存并启用账户行情源。','ACCOUNT_DISABLED',409);
    const status=await this.status();if(!status.credentialsReady)fail(messages.CREDENTIALS_MISSING,'CREDENTIALS_MISSING',428);if(!status.runtimeReady)fail(messages.SDK_NOT_INSTALLED,'SDK_NOT_INSTALLED',428);
    this.error='';this.state='connecting';const generation=++this.generation;
    this.emit('status',{status:'connecting',at:Date.now()});
    let child;try{child=this.spawnChild(this.python,['-u',join(this.root,'scripts','tqsdk_bridge.py'),'--config',this.path],{cwd:this.root,env:{...this.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});}catch{this.state='error';this.error=messages.SDK_NOT_INSTALLED;fail(this.error,'SDK_NOT_INSTALLED',428);}this.child=child;
    const lines=createInterface({input:child.stdout});lines.on('line',line=>{if(generation!==this.generation)return;if(line.length>2*1024*1024){this.state='error';this.error=messages.INVALID_DATA;child.kill('SIGTERM');return;}let record;try{record=JSON.parse(line);}catch{return;}this.receive(record);});
    // SDK diagnostics may contain authentication details. Never relay raw stdout/stderr to HTTP, MCP or logs.
    child.stderr.on('data',()=>{});
    child.once('error',()=>{if(generation!==this.generation)return;this.child=null;this.state='error';this.error=messages.SDK_NOT_INSTALLED;this.emit('status',{status:'error',message:this.error,at:Date.now()});});
    child.once('close',()=>{lines.close();if(generation!==this.generation)return;this.child=null;this.state='error';this.error=this.error||messages.BRIDGE_EXITED;this.emit('status',{status:'error',message:this.error,at:Date.now()});});
    return this.status();
  }
  meta(symbol,sourceTime){return {provider:'tqsdk',providerName:'TqSDK 账户行情',feedType:'push',sourceTime,receivedAt:Date.now(),delayMinutes:null,delayVerified:false,exchange:symbol.slice(3).replace(/^KQ\.[mi]@/,'').split('.')[0],currency:'CNY',priceBasis:'provider-ohlc',sourceUrl:'https://doc.shinnytech.com/tqsdk/latest/',warnings:['账户行情可用性与实时权限以账户授权为准。',...(symbol.includes('@')?['主连/指数使用天勤独立代码，未与新浪连续序列混用。']:[])]};}
  receive(record){
    if(record?.type==='error'){this.state='error';this.error=messages[record.code]||messages.CONNECTION_FAILED;return;}
    if(!record||!this.config.symbols.includes(record.sourceSymbol))return;const symbol=`TQ:${record.sourceSymbol}`;
    if(record.type==='quote'){
      const q=record.quote;if(!q||!finite(q.price)||q.price<=0||!finite(q.timestamp)||q.timestamp<=0)return;
      const quote={price:q.price,timestamp:q.timestamp};for(const key of ['previousClose','change','changePercent','volume'])quote[key]=finite(q[key])?q[key]:null;quote.changeReference='previous-settlement';
      const previous=this.quotes.get(symbol);if(previous&&quote.timestamp<previous.quote.timestamp)return;
      this.connected(quote.timestamp);const event={type:'quote',symbol,quote,meta:this.meta(symbol,quote.timestamp)};this.quotes.set(symbol,event);this.emit('data',event);
    }else if(record.type==='candles'&&this.config.intervals.includes(record.interval)&&Array.isArray(record.candles)&&record.candles.length<=1000){
      const valid=record.candles.filter(b=>b&&['timestamp','open','high','low','close','volume'].every(k=>finite(b[k]))&&b.timestamp>0&&b.volume>=0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low).map(b=>({timestamp:b.timestamp,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,closed:b.closed===true}));
      if(!valid.length)return;const key=`${symbol}|${record.interval}`,old=this.bars.get(key)||[];const map=new Map(old.map(b=>[b.timestamp,b]));for(const b of valid){if(map.get(b.timestamp)?.closed&&!b.closed)continue;map.set(b.timestamp,b);}
      const candles=[...map.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-this.config.historyLength);this.bars.set(key,candles);const sourceTime=this.quotes.get(symbol)?.quote.timestamp||candles.at(-1).timestamp;
      // Publish the preceding closure before the developing bar so clients can
      // use confirmed history immediately, without waiting for the next REST refresh.
      this.connected(sourceTime);for(const candle of candles.slice(-2))this.emit('data',{type:'candle',symbol,interval:record.interval,candle,meta:this.meta(symbol,sourceTime)});
    }
  }
  connected(sourceTime){this.lastReceivedAt=Date.now();this.lastSourceTime=sourceTime;if(this.state!=='connected')this.emit('status',{status:'connected',at:Date.now()});this.state='connected';this.error='';}
  async candles({symbol,interval,limit}){
    if(!this.catalog().some(v=>v.symbol===symbol))fail('该账户合约未配置，请在主机账户面板添加。','ACCOUNT_SYMBOL_NOT_CONFIGURED',404);
    if(!this.config.intervals.includes(interval))fail('该账户周期未配置。','UNSUPPORTED_INTERVAL',422);
    const started=Date.now();while(!this.bars.has(`${symbol}|${interval}`)&&this.child&&this.state!=='error'&&Date.now()-started<10000)await new Promise(resolve=>setTimeout(resolve,100));
    const rows=this.bars.get(`${symbol}|${interval}`);if(!rows?.length)fail(this.error||'账户行情尚未连接或尚未收到 K 线；公开行情仍可使用。','ACCOUNT_DATA_UNAVAILABLE',428);
    const candles=rows.slice(-limit),quote=this.quotes.get(symbol)?.quote||{price:candles.at(-1).close,timestamp:candles.at(-1).timestamp};
    return {symbol,interval,candles,quote,meta:{...this.meta(symbol,quote.timestamp),name:symbol,fetchedAt:Date.now(),feedType:this.state==='connected'?'push':'snapshot',cache:this.state==='connected'?'network':'stale',...(this.state!=='connected'?{warnings:['账户连接已断开，以下为上次收到的数据。']}: {})}};
  }
  async stop(){
    ++this.generation;const child=this.child;this.child=null;if(child)await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2500);child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
    this.state=this.config.enabled?'disconnected':'disabled';this.emit('status',{status:this.state,at:Date.now()});return this.status();
  }
}
