import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fetchCandles, fetchHistoryPage, MAX_CANDLE_LIMIT, SYMBOL_CATALOG } from './market-data.mjs';
import { createHistoryStore } from './history-store.mjs';
import { syncHistory } from './history-sync.mjs';
import { PAGE_GAP_MS, sleep } from './candle-pages.mjs';
import { createLiveCatalog, CATALOG_REFRESH_MS } from './live-catalog.mjs';
import { SharedCharts } from './shared-charts.mjs';
import { MarketHub } from './market-hub.mjs';
import { createAccess } from './access.mjs';
import { serveMcp } from './mcp.mjs';
import { AccountFeeds } from './account-feeds.mjs';
import { createMarketScope } from './market-scope.mjs';
import { ResearchService } from './research.mjs';
import { resolveStaticPath } from './static-path.mjs';
import { resolveFeishuWebhook } from './feishu.mjs';
import { alertMessage, createPriceAlerts, mergeFiredAlerts } from './price-alerts.mjs';
import { channelStatus, deliverPriceNotice, larkIdentity } from './lark-notify.mjs';
import { scanTradingViewLocal } from './tv-local.mjs';
import { planWatchlistImport } from './tv-watchlist-import.mjs';
import { pythFeed } from './pyth-feed.mjs';
import { FREE_GOLD_SOURCES, FREE_GOLD_INTERVALS } from './free-gold.mjs';
import { mergeWatchlist } from '../src/market-categories.js';
import { mergeSavedWatchlist, validWatchlist } from '../src/watchlist-state.js';
import { openWorkspaceStore } from './workspace-store.mjs';
import {adoptWorkspaceSettings,patchWorkspaceSettings} from './workspace-settings.mjs';
import { mergeAgentConfig, publicAgentStatus, requestAnnotations } from './agent-mark.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.TERMINAL_DATA_DIR || join(root, 'data'));
const cacheDir = join(dataDir, 'candles');
const port = Number(process.env.TERMINAL_PORT || 18765);
const host = process.env.TERMINAL_HOST || '127.0.0.1';
if(!['127.0.0.1','0.0.0.0'].includes(host)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('TERMINAL_HOST / TERMINAL_PORT 无效。');
const active = new Map();
let stateWrite = Promise.resolve();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
await mkdir(cacheDir, { recursive: true });
const historyStore = createHistoryStore(join(cacheDir, 'series'));
const freeGoldStatusPath=join(cacheDir,'free-gold-status.json');
let freeGoldHistory=await readJson(freeGoldStatusPath,{running:false,results:[]});
if(freeGoldHistory.running)freeGoldHistory={...freeGoldHistory,running:false,interrupted:true};
async function prepareFreeGoldHistory(){
  if(freeGoldHistory.running)return;
  freeGoldHistory={running:true,startedAt:Date.now(),results:[]};
  await atomicJson(freeGoldStatusPath,freeGoldHistory);
  try{
    for(const interval of FREE_GOLD_INTERVALS)for(const {symbol} of FREE_GOLD_SOURCES){
      freeGoldHistory.current={symbol,interval};
      try{
        await candles(new URLSearchParams({symbol,interval,limit:'1000',refresh:'1'}));
        const result=['1d','1w'].includes(interval)?await syncHistory({symbol,interval,store:historyStore,fetchPage:fetchHistoryPage,pause:()=>sleep(PAGE_GAP_MS)}):await historyStore.stat(symbol,interval);
        freeGoldHistory.results.push({symbol,interval,count:result.count,oldest:result.oldest,newest:result.newest,exhausted:Boolean(result.exhausted)});
      }catch(error){freeGoldHistory.results.push({symbol,interval,error:error.message});}
      await atomicJson(freeGoldStatusPath,freeGoldHistory);
    }
  }finally{freeGoldHistory.running=false;freeGoldHistory.finishedAt=Date.now();await atomicJson(freeGoldStatusPath,freeGoldHistory);}
}
let pythHistory = { running: false, results: [] };
async function backfillPythHistory() {
  if (pythHistory.running) return;
  pythHistory = { running: true, startedAt: Date.now(), results: [] };
  try {
    for (const interval of ['1d', '1w', '4h', '1h']) {
      pythHistory.interval = interval;
      try {
        const result = await syncHistory({ symbol: 'PYTH:XAUUSD', interval, store: historyStore, fetchPage: fetchHistoryPage, pause: () => sleep(PAGE_GAP_MS) });
        pythHistory.results.push(result);
      } catch (error) {
        const saved = await historyStore.stat('PYTH:XAUUSD', interval);
        pythHistory.results.push({ interval, count: saved.count, oldest: saved.oldest, newest: saved.newest, warning: error.message });
      }
    }
  } finally { pythHistory.running = false; pythHistory.finishedAt = Date.now(); }
}
const liveCatalog = await createLiveCatalog({ path: join(dataDir, 'public-catalog.json'), base: SYMBOL_CATALOG });
const serveHosts=String(process.env.TERMINAL_SERVE_HOSTS||'').split(',').map(s=>s.trim()).filter(Boolean);
const access=await createAccess(dataDir,port,host,serveHosts);
const workspace=await openWorkspaceStore(dataDir);
const charts=new SharedCharts(join(dataDir,'charts.sqlite'),workspace.read());
workspace.setChartSource(()=>charts.get('main').state);
const domesticFutures=process.env.TERMINAL_DOMESTIC_FUTURES==='1';
const accounts=domesticFutures?await new AccountFeeds({root,dataDir}).init():null;
const markets=createMarketScope({domesticFutures,accounts,publicCatalog:liveCatalog.catalog});
void liveCatalog.refresh();
const catalogTimer=setInterval(()=>void liveCatalog.refresh(),CATALOG_REFRESH_MS);catalogTimer.unref();
function enqueueState(task){
  const run=stateWrite.then(task,task);
  stateWrite=run.catch(()=>{});
  return run;
}
const webhookConfig=()=>readJson(join(dataDir,'notify.json'),{});
const priceAlerts=createPriceAlerts({
  readState:()=>workspace.read(),
  updateAlerts:fired=>enqueueState(async()=>{
    const current=workspace.read();
    if(!current||typeof current!=='object'||!Array.isArray(current.alerts))return;
    let changed=false;
    for(const next of fired){
      const alert=current.alerts.find(item=>item?.id===next.id);
      if(!alert||alert.firedAt)continue;
      alert.firedAt=next.firedAt;alert.triggerPrice=next.triggerPrice;alert.notice=next.notice;changed=true;
    }
    if(changed)workspace.write(current);
  }),
  deliver:async(alert,price)=>{
    const result=await deliverPriceNotice(alertMessage(alert,price),{readConfig:webhookConfig,idempotencyKey:`alert-${alert.id}`});
    return result.commit?{commit:true,notice:result.notice}:{commit:false};
  },
  publish:event=>hub.publish(event),
});
let hub=new MarketHub({accounts,onEvent:event=>priceAlerts.onEvent(event)});
accounts?.on('data',event=>hub.publish(event));
accounts?.on('status',event=>hub.publish({type:'status',provider:'tqsdk',...event}));
// 后台盯盘：读取工作区未触发提醒的标的，交由行情中枢在没有页面客户端时也保持订阅与评估。
function refreshAlertDemand(){
  Promise.resolve(workspace.read()).then(state=>{
    const alerts=Array.isArray(state?.alerts)?state.alerts:[];
    const symbols=[...new Set(alerts.filter(a=>a&&!a.firedAt&&typeof a.symbol==='string').map(a=>a.symbol.trim().toUpperCase()).filter(Boolean))];
    hub.setBackgroundSymbols(symbols);
  }).catch(()=>{});
}
const alertDemandTimer=setInterval(refreshAlertDemand,60_000);alertDemandTimer.unref();refreshAlertDemand();
const quote=(symbol,waitMs)=>{markets.assertSymbol(symbol);return hub.quote(symbol,waitMs);};
const research=new ResearchService({candles});
const streams=new Set();
function eventStream(req,res){
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 2000\n\n');streams.add(res);
  const keepAlive=setInterval(()=>{if(!res.destroyed)res.write(': keepalive\n\n');},15000);
  const send=(type,data)=>{if(res.destroyed)return;if(res.writableLength>2*1024*1024){res.end();return;}res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
  res.once('close',()=>{clearInterval(keepAlive);streams.delete(res);});return send;
}

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
}

async function candles(params) {
  const symbol = params.get('symbol') || 'BTCUSDT';
  const interval = params.get('interval') || '1d';
  const limit = Number(params.get('limit') || 800);
  const beforeText = params.get('before');
  const before = beforeText == null || beforeText === '' ? undefined : Number(beforeText);
  markets.assertSymbol(symbol);
  if (!/^[A-Za-z0-9.@^=:_/-]{1,50}$/.test(symbol) || !['1m','5m','15m','30m','1h','4h','1d','1w'].includes(interval) || !Number.isInteger(limit) || limit < 2 || limit > MAX_CANDLE_LIMIT || (before !== undefined && (!Number.isSafeInteger(before) || before <= 0))) {
    throw Object.assign(new Error('标的、周期或数据条数无效。'), { status: 400 });
  }
  if(symbol.startsWith('TQ:'))return accounts.candles({symbol,interval,limit});
  const refresh = params.get('refresh') === '1';
  const key = `${symbol}|${interval}|${limit}|${before ?? ''}|${refresh ? 1 : 0}`;
  if (active.has(key)) return active.get(key);
  const request = (async () => {
    const saved = await historyStore.read({ symbol, interval, before, limit });
    const tailFresh = before == null && saved.updatedAt && Date.now() - saved.updatedAt < 60_000;
    if (!refresh && saved.complete && (before != null || tailFresh)) return storedCandles(symbol, interval, saved, 'fresh');
    try {
      const payload = await fetchCandles({ symbol, interval, limit, before });
      const markExhausted = Boolean(payload.meta?.exhausted) && (before != null || payload.candles.length < limit);
      await historyStore.merge({ symbol, interval, bars: payload.candles, exhausted: markExhausted, quote: payload.quote, feed: payload.meta });
      return { ...payload, meta: { ...payload.meta, cache: 'network', cachedAt: Date.now() } };
    } catch (error) {
      if (saved.candles.length) return storedCandles(symbol, interval, saved, 'stale', error.message);
      throw error;
    }
  })();
  active.set(key, request);
  try { return await request; } finally { active.delete(key); }
}

function storedCandles(symbol, interval, saved, cache, failure) {
  const warnings = [...(saved.feed?.warnings || [])];
  if (failure) warnings.push(`在线更新失败，正在使用 ${new Date(saved.updatedAt).toISOString()} 保存的历史缓存：${failure}`);
  const last = saved.candles.at(-1);
  return {
    symbol, interval, candles: saved.candles,
    quote: saved.quote || { price: last?.close ?? null, timestamp: last?.timestamp ?? null, change: null, changePercent: null, volume: last?.volume ?? null },
    meta: { ...(saved.feed || {}), cache, cachedAt: saved.updatedAt, returnedCount: saved.candles.length, exhausted: Boolean(saved.exhausted), warnings },
  };
}

async function body(req) {
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 4 * 1024 * 1024) throw Object.assign(new Error('工作区文件过大，最大 4 MB。'), { status: 413 });
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式无效。'), { status: 400 }); }
}

const server = http.createServer(async (req, res) => {
  if(!access.allowed(req))return json(res,403,{error:'访问主机或请求来源无效。'});
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if(url.pathname==='/api/health')return json(res,200,{ok:true,app:'shanhai-market-terminal',name:'ChartBridge',displayName:'图桥',version:'0.4.1',mode:host==='0.0.0.0'?'lan':'local',features:markets.features,at:new Date().toISOString()});
    if(url.pathname==='/api/session'&&req.method==='POST'){
      const value=await body(req);if(!access.login(value?.token,res))return json(res,401,{error:'连接凭据无效。'});return json(res,200,{ok:true});
    }
    if(url.pathname==='/api/session'&&req.method==='DELETE'){access.logout(req,res);return json(res,200,{ok:true});}
    const principal=access.principal(req);
    if((url.pathname.startsWith('/api/')||url.pathname==='/mcp')&&!principal){res.setHeader('WWW-Authenticate','Bearer realm="shanhai-lan"');return json(res,401,{error:'请输入这台主机提供的局域网连接凭据。',code:'AUTH_REQUIRED'});}
    if(url.pathname==='/mcp')return await serveMcp(req,res,{principal,charts,hub,candles,quote,markets,research});
    if(url.pathname==='/api/connection'&&req.method==='GET')return json(res,200,{...access.connection(principal),features:markets.features});
    if(url.pathname==='/api/access'&&req.method==='GET'){
      if(!principal.local)return json(res,403,{error:'请在主机的 localhost 界面查看连接凭据。'});
      return json(res,200,{...access.connection(principal),credentials:access.credentials});
    }
    if(url.pathname.startsWith('/api/accounts')&&!domesticFutures)return json(res,422,{error:'国内期货及账户行情已停用，原有配置仍保留。',code:'MARKET_DISABLED'});
    if(url.pathname==='/api/accounts'&&req.method==='GET')return json(res,200,{status:await accounts.status()});
    if(url.pathname.startsWith('/api/accounts/')){
      if(!principal.local)return json(res,403,{error:'账户配置和连接仅可在主机 localhost 页面操作。'});
      if(url.pathname==='/api/accounts/config'&&req.method==='GET')return json(res,200,{config:accounts.config,status:await accounts.status()});
      if(url.pathname==='/api/accounts/config'&&req.method==='PUT')return json(res,200,await accounts.save(await body(req)));
      if(url.pathname==='/api/accounts/connect'&&req.method==='POST')return json(res,200,{status:await accounts.connect()});
      if(url.pathname==='/api/accounts/disconnect'&&req.method==='POST')return json(res,200,{status:await accounts.disconnect()});
    }
    if(url.pathname==='/api/feed-status'&&req.method==='GET')return json(res,200,hub.snapshot());
    if(url.pathname==='/api/quote'&&req.method==='GET')return json(res,200,await quote(url.searchParams.get('symbol')||'BTCUSDT',Number(url.searchParams.get('waitMs')||8000)));
    if(req.method==='POST'&&['/api/research/indicators','/api/research/backtest'].includes(url.pathname))return json(res,200,await research.run(url.pathname.split('/').at(-1),await body(req)));
    if(url.pathname==='/api/stream'&&req.method==='GET'){
      const symbol=url.searchParams.get('symbol')||'BTCUSDT',interval=url.searchParams.get('interval')||'1m';
      const secondaryInterval=url.searchParams.get('secondaryInterval');
      const requests=[{symbol,interval},...(secondaryInterval&&secondaryInterval!==interval?[{symbol,interval:secondaryInterval}]:[]),...(url.searchParams.get('symbols')||'').split(',').filter(Boolean).filter(s=>s!==symbol).map(symbol=>({symbol}))];
      // Validate before committing SSE headers.
      if(requests.length>50||requests.some(r=>!/^[A-Za-z0-9.@^=:_/-]{1,50}$/.test(r.symbol)||r.interval&&!['1m','5m','15m','30m','1h','4h','1d','1w'].includes(r.interval)))return json(res,400,{error:'行情订阅参数无效。'});
      for(const request of requests)markets.assertSymbol(request.symbol);
      const send=eventStream(req,res),release=hub.subscribe(requests,event=>send(event.type,event));res.once('close',release);refreshAlertDemand();void priceAlerts.scan([...hub.quotes.values()]);return;
    }
    const room=url.searchParams.get('room')||'main';
    if(url.pathname==='/api/chart'&&req.method==='GET')return json(res,200,charts.get(room));
    if(url.pathname==='/api/chart/history'&&req.method==='GET'){
      const after=Number(url.searchParams.get('after')||0),limit=Number(url.searchParams.get('limit')||25);
      if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)return json(res,400,{error:'历史分页参数无效。'});
      return json(res,200,{roomId:room,changes:charts.history(room,after,limit)});
    }
    if(url.pathname==='/api/chart/operations'&&req.method==='POST')return json(res,200,charts.apply(room,await body(req),principal));
    if(url.pathname==='/api/chart/events'&&req.method==='GET'){
      // Subscribe before reading the initial snapshot so a commit in between is
      // still delivered as a change event instead of falling into the gap.
      const send=eventStream(req,res);let initial=null;
      const changed=event=>{if(initial===null&&event.roomId===room){initial=event;}else if(event.roomId===room)send('chart',event);};
      charts.on('change',changed);
      initial=charts.get(room);send('chart',initial);
      res.once('close',()=>charts.off('change',changed));return;
    }
    if(url.pathname==='/api/workspace-sync'&&req.method==='GET')return json(res,200,workspace.settings());
    if(url.pathname==='/api/workspace-sync/events'&&req.method==='GET'){
      const send=eventStream(req,res),changed=snapshot=>send('settings',snapshot);
      workspace.on('settings',changed);const snapshot=workspace.settings();send('settings',snapshot);res.once('close',()=>workspace.off('settings',changed));return;
    }
    if(url.pathname==='/api/workspace-sync/adopt'&&req.method==='POST'){
      const value=await body(req),snapshot=await enqueueState(()=>adoptWorkspaceSettings(workspace,value,principal));
      refreshAlertDemand();return json(res,200,snapshot);
    }
    if(url.pathname==='/api/workspace-sync'&&req.method==='PATCH'){
      const value=await body(req),snapshot=await enqueueState(()=>patchWorkspaceSettings(workspace,value,principal));
      refreshAlertDemand();void priceAlerts.scan([...hub.quotes.values()]);return json(res,200,snapshot);
    }
    if(url.pathname==='/api/feeds/gold/free'){
      if(!principal.local)return json(res,403,{error:'请在本机页面配置免费黄金行情。'});
      if(req.method==='GET')return json(res,200,{sources:FREE_GOLD_SOURCES,history:freeGoldHistory});
      if(req.method==='POST'){
        const value=await body(req);
        if(!value||typeof value!=='object'||Array.isArray(value))return json(res,400,{error:'请求格式无效。'});
        if(value.watchlist!=null&&(!Array.isArray(value.watchlist)||value.watchlist.length>150||value.watchlist.some(symbol=>typeof symbol!=='string'||!/^[A-Z0-9.^=:_/-]{1,50}$/.test(symbol))))return json(res,400,{error:'自选清单格式无效。'});
        const watchlist=await enqueueState(async()=>{
          const saved=workspace.read();
          let merged;
          try{merged=mergeWatchlist(saved.watchlist||[],[...(value.watchlist||[]),...FREE_GOLD_SOURCES.map(row=>row.symbol)]).watchlist;}
          catch(error){throw Object.assign(error,{status:400});}
          workspace.write({...saved,watchlist:merged});return merged;
        });
        void prepareFreeGoldHistory().catch(()=>{});
        return json(res,200,{sources:FREE_GOLD_SOURCES,watchlist,history:freeGoldHistory});
      }
      return json(res,405,{error:'不支持的请求方法。'});
    }
    if (url.pathname === '/api/feeds/pyth') {
      if (!principal.local) return json(res, 403, { error: '请在本机页面配置 PYTH 数据授权。' });
      if (req.method === 'GET') return json(res, 200, { ...await pythFeed.status(), history: pythHistory });
      if (req.method === 'PUT') {
        const value = await body(req);
        const result = await pythFeed.save(value?.apiKey);
        void backfillPythHistory().catch(() => {});
        return json(res, 200, { ...result, history: pythHistory });
      }
      return json(res, 405, { error: '不支持的请求方法。' });
    }
    if (url.pathname === '/api/catalog') { await liveCatalog.refresh(); return json(res, 200, { results: markets.catalog(), meta: liveCatalog.meta() }); }
    if (url.pathname === '/api/candles/backfill' && req.method === 'POST') {
      if (!principal.local) return json(res, 403, { error: '补齐历史只在主机本机进行。' });
      const value = await body(req);
      const symbol = String(value?.symbol || '').trim().toUpperCase();
      const interval = String(value?.interval || '1d');
      markets.assertSymbol(symbol);
      if (!['1m','5m','15m','30m','1h','4h','1d','1w'].includes(interval)) return json(res, 400, { error: '周期无效。' });
      const result = await syncHistory({ symbol, interval, store: historyStore, fetchPage: args => fetchHistoryPage(args), pause: () => sleep(PAGE_GAP_MS) });
      return json(res, 200, result);
    }
    if (url.pathname === '/api/candles') return json(res, 200, await candles(url.searchParams));
    if (url.pathname === '/api/search'){
      await liveCatalog.refresh();
      const result=await markets.search((url.searchParams.get('q')||'').slice(0,80));
      return json(res,200,{...result,meta:{...result.meta,warnings:[...(result.meta?.warnings||[]),...liveCatalog.meta().warnings]}});
    }
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200,principal.local?workspace.read():{});
    if(url.pathname==='/api/alerts/channel'&&req.method==='GET'){
      const [identity,target]=await Promise.all([larkIdentity(),resolveFeishuWebhook({readConfig:webhookConfig})]);
      return json(res,200,channelStatus(identity,target));
    }
    if(url.pathname==='/api/tv-local'&&req.method==='GET'){
      if(!principal.local)return json(res,403,{error:'本机 TradingView 库只在主机 localhost 页面读取。'});
      return json(res,200,scanTradingViewLocal(process.env,{listId:url.searchParams.get('list')}));
    }
    if(url.pathname==='/api/tv-local/import'&&req.method==='POST'){
      if(!principal.local)return json(res,403,{error:'本机自选只在主机 localhost 页面同步。'});
      const value=await body(req);
      if(value.watchlist!==undefined&&(!Array.isArray(value.watchlist)||value.watchlist.length>150||value.watchlist.some(symbol=>typeof symbol!=='string')))return json(res,400,{error:'自选列表无效或超过 150 个。'});
      const found=scanTradingViewLocal(process.env,{listId:value.listId});
      await liveCatalog.refresh();
      let imported;
      await enqueueState(async()=>{
        const previous=workspace.read();
        const current=Array.isArray(value.watchlist)?{...previous,watchlist:value.watchlist}:previous;
        imported=planWatchlistImport(found,current,markets.catalog());
        await liveCatalog.addInstruments(imported.instruments);
        if(value.apply===true){
          workspace.write({...previous,watchlist:imported.watchlist});
        }
      });
      return json(res,200,{...imported,sourceCount:found.symbols.length});
    }
    if(url.pathname==='/api/agent/status'&&req.method==='GET'){
      if(!principal.local)return json(res,403,{error:'Agent 配置只在主机 localhost 页面读取。'});
      const saved=await readJson(join(dataDir,'agent.json'),{});
      return json(res,200,publicAgentStatus(mergeAgentConfig(saved,{},process.env)));
    }
    if(url.pathname==='/api/agent/annotate'&&req.method==='POST'){
      if(!principal.local)return json(res,403,{error:'Agent 标注只在主机 localhost 页面调用。'});
      const value=await body(req);
      const symbol=String(value?.symbol||'');
      const interval=String(value?.interval||'1d');
      markets.assertSymbol(symbol);
      if(!['1m','5m','15m','30m','1h','4h','1d','1w'].includes(interval))return json(res,400,{error:'周期无效。'});
      const saved=await readJson(join(dataDir,'agent.json'),{});
      const config=mergeAgentConfig(saved,{apiKey:value?.apiKey,baseUrl:value?.baseUrl,model:value?.model},process.env);
      if(value?.baseUrl||value?.model||value?.apiKey){
        const stored={baseUrl:config.baseUrl,model:config.model};
        if(value?.apiKey)stored.apiKey=config.apiKey;
        else if(saved?.apiKey)stored.apiKey=saved.apiKey;
        await atomicJson(join(dataDir,'agent.json'),stored);
      }
      const market=await fetchCandles({symbol,interval,limit:80});
      const result=await requestAnnotations({config,symbol,interval,candles:market.candles});
      return json(res,200,result);
    }
    if(url.pathname==='/api/alerts/test'&&req.method==='POST'){
      if(!principal.local)return json(res,403,{error:'飞书测试只在主机本机页面发送。'});
      const result=await deliverPriceNotice('【测试】图桥价格提醒通道。这不是真实价格触发。',{readConfig:webhookConfig,idempotencyKey:'shanhai-alert-test'});
      const reasonText={missing_webhook:'还没有可用的飞书身份或 webhook。',invalid_webhook:'飞书 webhook 格式无效。',upstream_unreachable:'飞书 webhook 连不上。',upstream_rejected:'飞书拒绝了测试消息。',cli_unavailable:'lark-cli 没有可用的用户或机器人身份。',cli_no_user:'lark-cli 没有可发送的用户。',cli_rejected:'lark-cli 没有返回消息编号。',confirmation_required:'飞书 CLI 要求再次确认后才能发送。'};
      return json(res,result.sent?200:503,{sent:Boolean(result.sent),reason:result.reason||'',channel:result.channel||'',messageId:result.messageId||'',...(result.sent?{}:{error:reasonText[result.reason]||'飞书测试没有发出。'})});
    }
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      if(!principal.local)return json(res,403,{error:'远端个人偏好保存在浏览器；请通过协作接口编辑共享图表。'});
      const value = await body(req);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(res, 400, { error: '工作区必须是 JSON 对象。' });
      const {watchlistBase,...next}=value;
      if(next.watchlist!==undefined&&!validWatchlist(next.watchlist)||watchlistBase!==undefined&&!validWatchlist(watchlistBase))return json(res,400,{error:'自选列表无效或超过 150 个。'});
      let savedWatchlist;
      await enqueueState(async () => {
        const old = workspace.read();
        // Older tabs still send entire workspaces. Once synchronized, those
        // snapshots must not replace settings changed on an up-to-date terminal.
        const shared=workspace.settings();
        if(shared.initialized)Object.assign(next,shared.fields);
        if(next.watchlist!==undefined){
          try{next.watchlist=validWatchlist(old.watchlist)?mergeSavedWatchlist(watchlistBase||[],next.watchlist,old.watchlist):next.watchlist;}catch(error){throw Object.assign(error,{status:400});}
        }
        workspace.write(mergeFiredAlerts(old,next));savedWatchlist=next.watchlist;
      });
      refreshAlertDemand();
      void priceAlerts.scan([...hub.quotes.values()]);
      return json(res, 200, { ok: true, savedAt: Date.now(),watchlist:savedWatchlist });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在。' });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'URL 无效。' }); }
    const dist = join(root, 'dist');
    const path = resolveStaticPath(dist, pathname);
    let contents;
    try { contents = await readFile(path); }
    catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('文件不存在。首次运行请先执行 npm run build，再执行 npm start。');
      }
      throw error;
    }
    // The Pine worker receives no network or document authority.
    const worker = /pine-worker[^/]*\.js$/.test(pathname);
    res.setHeader('Content-Security-Policy', worker
      ? "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'");
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    console.error(`[${url.pathname}] ${error.message}`);
    if(res.headersSent){res.end();return;}
    json(res, error.status || 502, { error: error.message, code: error.code || 'REQUEST_FAILED',...(error.details?{details:error.details}:{}) });
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用。现有终端可能已在运行：http://127.0.0.1:${port}` : error.message);
  process.exitCode = 1;
});
server.listen(port,host,()=>console.log(`ChartBridge · 图桥 — 本地交易研究工作台\nLocal: http://127.0.0.1:${port}\n${access.connection({role:'owner',local:true}).urls.map(url=>`LAN: ${url}`).join('\n')}\n数据目录: ${dataDir}\n局域网凭据请在本机页面的「协作」中查看。按 Ctrl+C 停止。`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{hub.close();await accounts?.disconnect();for(const stream of streams)stream.end();server.close(()=>{charts.close();workspace.close();process.exit(0);});server.closeIdleConnections();});
