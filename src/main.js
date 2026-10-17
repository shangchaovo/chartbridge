import './style.css';
import { init, dispose, registerIndicator, registerOverlay, getSupportedIndicators, getSupportedOverlays } from 'klinecharts';
import { runBacktest } from './backtest.js';
import { parseCandlesCsv, exportCandlesCsv } from './csv-data.js';
import { icon } from './icons.js';
import { ChartCollaboration, newId } from './collaboration.js';
import { chartStateFromWorkspace, diffChartStates, mergeChartStates } from './collab-state.js';
import { LiveFeed } from './live-feed.js';
import { collectPineRequests,canonicalSymbol } from './pine-data.js';
import { mountAccountSettings } from './account-settings.js';
import { mountAgentResearch } from './agent-research.js';
import { nextPriceRange, wheelScale } from './price-axis.js';
import { activateSymbolMarks, symbolMark } from './symbol-mark.js';
import { importTradingViewConfig } from './tv-import.js';
import { initPanelLayout } from './panel-layout.js';
import { DRAWING_NAMES, DRAWING_TOOLS } from './drawing-catalog.js';
import { DrawingHistory } from './drawing-history.js';
import { registerChartOverlays } from './chart-overlays.js';
import { renderDrawingToolbar, closeDrawingMenu, drawingChoice } from './drawing-toolbar.js';
import { SHORTCUTS, matchShortcut } from './shortcuts.js';
import { DEFAULT_CHART_PREFERENCES, loadChartPreferences, normalizeChartPreferences } from './chart-preferences.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = (value, precision) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: precision ?? (Math.abs(value) < 1 ? 4 : 2), maximumFractionDigits: precision ?? (Math.abs(value) < 1 ? 6 : 2) }) : '—';
const pct = value => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%` : '—';
const sign = value => value > 0 ? 'positive' : value < 0 ? 'negative' : '';
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const shortDate = value => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
const marketNames = {crypto:'加密现货',us:'美股',hk:'港股',cn:'A股','cn-futures':'国内期货',forex:'外汇',futures:'国际期货',indices:'指数',global:'其他市场',local:'本地数据'};
const examples = {
  ema: '//@version=6\nindicator("双均线 EMA", overlay=true)\nfast = input.int(12, "快线")\nslow = input.int(26, "慢线")\nplot(ta.ema(close, fast), "EMA 快线", color=color.aqua, linewidth=2)\nplot(ta.ema(close, slow), "EMA 慢线", color=color.orange, linewidth=2)\nplotshape(ta.crossover(ta.ema(close, fast), ta.ema(close, slow)), title="上穿", style=shape.triangleup, location=location.belowbar, color=color.lime, text="上穿")',
  rsi: '//@version=6\nindicator("RSI 动量", overlay=false)\nlength = input.int(14, "周期")\nplot(ta.rsi(close, length), "RSI", color=color.aqua, linewidth=2)\nhline(70, "超买", color=color.red)\nhline(30, "超卖", color=color.green)',
  macd: '//@version=5\nindicator("MACD", overlay=false)\n[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)\nplot(macdLine, "MACD", color=color.aqua)\nplot(signalLine, "Signal", color=color.orange)\nplot(hist, "Histogram", style=plot.style_histogram, color=color.teal)',
  strategy: '//@version=6\nstrategy("均线策略 · 实验", overlay=true)\nfast = ta.sma(close, 10)\nslow = ta.sma(close, 30)\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.close("Long")\nplot(fast, "快线", color=color.aqua)\nplot(slow, "慢线", color=color.orange)',
};
const defaults = {
  schemaVersion: 1, symbol: 'BTCUSDT', interval: '1d', theme: 'dark', chartType: 'candle_solid', dual: false,
  secondaryInterval: '1h', watchlist: ['BTCUSDT','ETHUSDT','AAPL','NVDA','0700.HK','600519.SS','EURUSD=X','GC=F'],
  indicators: ['EMA','VOL'], indicatorParams: { MA:[5,10,20], EMA:[12,26], BOLL:[20,2], RSI:[14] }, drawings:{},
  alerts:[], pineCode:examples.ema, scripts:{}, imports:{}, notes:{}, autoRefresh:true,
  backtestOptions:{strategy:'ema-cross',fast:12,slow:26,initialCapital:100000,feeBps:10,slippageBps:5},
};
let state = structuredClone(defaults);
let catalog = [], chart, secondaryChart, payload, allCandles = [], activeTab = 'backtest', marketFilter = 'all';
let refreshPanelLayout = () => {};
let loadingId = 0, backtestResult = null, pineResult = null, replay = false, replayCount = 0, replayTimer = null;
let pineWorker = null, saveTimer = null, toastTimer, autoBusy = false, currentTool = '', magnet = 'normal', drawingsLocked = false, selectedDrawing = '';
let pendingDrawing='',keepDrawing=localStorage.getItem('shanhai-keep-drawing')==='1',drawingsHidden=localStorage.getItem('shanhai-hide-drawings')==='1';
const drawingHistory=new DrawingHistory(),drawingVisibility=new Map(),toolChoices={};
const chartPreferences=loadChartPreferences(localStorage);
try{Object.assign(toolChoices,JSON.parse(localStorage.getItem('shanhai-drawing-tools')||'{}'));}catch{}
let collaboration=null,connection=null,restoringDrawings=false,sharedApplying=false,liveMeta=null,streamState='connecting',gapRepair=null;
let actorId=localStorage.getItem('shanhai-actor-id');if(!actorId){actorId=newId();localStorage.setItem('shanhai-actor-id',actorId);}
const actor={id:actorId,name:localStorage.getItem('shanhai-actor-name')||'图表研究者'};
const liveFeed=new LiveFeed({event:applyLiveEvent,status:updateLiveStatus});
const quotes = new Map(), drawingIds = new Set(), subPanes = new Map();
let chartClipboard=null,chartPointer={price:null,timestamp:null};
const indicatorDescriptions = {MA:'简单移动均线',EMA:'指数移动均线',BOLL:'布林带',SAR:'抛物线转向',BBI:'多空指标',VOL:'成交量',MACD:'平滑异同均线',RSI:'相对强弱',KDJ:'随机指标',ATR:'平均真实波幅',CCI:'顺势指标',DMI:'趋向指标',OBV:'能量潮',WR:'威廉指标',ROC:'变动率',MTM:'动量',TRIX:'三重指数平滑',VR:'成交量比率',BRAR:'情绪指标',EMV:'简易波动',DMA:'平行线差',PSY:'心理线'};
const onPricePane = new Set(['MA','EMA','BOLL','SAR','BBI']);
const supportedIndicators = getSupportedIndicators();

function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4200);
}
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `请求失败 (${response.status})`),{status:response.status,code:result.code,details:result.details});
  return result;
}
function enabledSymbol(symbol){return connection?.features?.domesticFutures||!/^(SINA:|TQ:)/i.test(symbol);}
function currentInstrument() { return catalog.find(item => item.symbol === state.symbol) || {symbol:state.symbol,name:state.symbol,market:state.imports[state.symbol]?'local':'us',exchange:payload?.meta.exchange || ''}; }
function visibleCandles() { return replay ? allCandles.slice(0,replayCount) : allCandles; }
function closedCandles() { const values = visibleCandles(); return state.imports[state.symbol]||replay ? values : values.filter((bar,index)=>bar.closed===true||(bar.closed===undefined&&index<values.length-1)); }
function chartColors() {
  const css = getComputedStyle(document.body); return Object.fromEntries(['bg','line','text','muted','faint','accent','up','down','blue'].map(key => [key,css.getPropertyValue(`--${key}`).trim()]));
}
function styleChart(target) {
  const c = chartColors();
  target.setStyles(state.theme === 'light' ? 'light' : 'dark');
  target.setStyles({
    grid:{show:chartPreferences.grid,horizontal:{show:chartPreferences.grid,color:c.line,style:'dashed',dashedValue:[2,5]},vertical:{show:chartPreferences.grid,color:c.line,style:'dashed',dashedValue:[2,5]}},
    candle:{type:state.chartType,bar:{upColor:c.up,downColor:c.down,noChangeColor:c.muted,upBorderColor:c.up,downBorderColor:c.down,noChangeBorderColor:c.muted,upWickColor:c.up,downWickColor:c.down,noChangeWickColor:c.muted},area:{lineSize:2,lineColor:c.accent,backgroundColor:[{offset:0,color:state.theme==='light'?'rgba(138,98,48,.10)':'rgba(212,169,78,.10)'},{offset:1,color:'rgba(212,169,78,0)'}]},tooltip:{showRule:'none'},priceMark:{last:{upColor:c.up,downColor:c.down,noChangeColor:c.muted,text:{color:state.theme==='light'?'#ffffff':'#0b0f17'}}}},
    indicator:{tooltip:{showRule:'follow_cross',text:{color:c.muted,size:10}},lines:[{color:c.blue,size:1.4},{color:'#d5aa62',size:1.2},{color:'#a491cf',size:1.2}]},
    xAxis:{axisLine:{color:c.line},tickLine:{show:false},tickText:{color:c.muted,size:9}},
    yAxis:{type:chartPreferences.scale,reverse:chartPreferences.reverse,axisLine:{show:false},tickLine:{show:false},tickText:{color:c.muted,size:9}},
    separator:{color:c.line,activeBackgroundColor:c.line},
    crosshair:{show:chartPreferences.crosshair,horizontal:{line:{color:c.faint},text:{color:c.text,backgroundColor:c.raised || c.line}},vertical:{line:{color:c.faint},text:{color:c.text,backgroundColor:c.line}}},
    overlay:{line:{color:c.accent,size:1},point:{color:c.bg,borderColor:c.accent,borderSize:1},text:{color:c.accent,size:10},rect:{color:'rgba(212,169,78,.08)',borderColor:c.accent}},
  });
  target.setLocale('zh-CN'); target.setTimezone('Asia/Shanghai'); target.setOffsetRightDistance(55);
  target.setStyles({candle:{priceMark:{last:{show:chartPreferences.lastPrice}}}});
  $$('.chart-watermark').forEach(el=>el.classList.toggle('hidden',!chartPreferences.watermark));
  $$('[data-price-scale]').forEach(button=>button.classList.toggle('selected',button.dataset.priceScale===chartPreferences.scale));
}
function rememberAxis(target){
  const host=target.getDom?.()?.parentElement;if(!host)return;
  host.dataset.barSpace=String(target.getBarSpace());
  const range=target.getDrawPaneById?.('candle_pane')?.getAxisComponent?.().getRange?.();
  if(Number.isFinite(range?.realRange))host.dataset.priceSpan=String(range.realRange);
}
function resetPriceScale(target){
  for(const pane of target.getAllDrawPanes?.()||[])pane.getAxisComponent?.().setAutoCalcTickFlag?.(true);
  target.adjustPaneViewport?.(false,true,true,true,true);
}
function bindPriceAxisWheel(target){
  const root=target.getDom?.();if(!root||root.dataset.priceWheel==='1')return;
  root.dataset.priceWheel='1';
  const host=root.parentElement||root;
  root.addEventListener('wheel',event=>{
    const scale=wheelScale(event);if(!scale)return;
    const panes=target.getAllDrawPanes?.()||[];
    const pane=panes.find(item=>{
      const el=target.getDom(item.getId(),'yAxis');if(!el)return false;
      const box=el.getBoundingClientRect();
      return event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;
    });
    if(!pane)return;
    const yAxis=pane.getAxisComponent?.();
    if(!yAxis?.getScrollZoomEnabled?.())return;
    const next=nextPriceRange(yAxis.getRange?.(),scale,value=>yAxis.convertToRealValue(value));
    if(!next)return;
    event.preventDefault();event.stopPropagation();
    yAxis.setRange(next);
    target.adjustPaneViewport(false,true,true,true);
    markPriceAxes(target);rememberAxis(target);
  },{capture:true,passive:false});
  target.subscribeAction('onZoom',()=>{host.dataset.timeZoom=String(target.getBarSpace());rememberAxis(target);});
  target.subscribeAction('onScroll',()=>{host.dataset.scrolled='1';});
  markPriceAxes(target);
}
function markPriceAxes(target){
  for(const pane of target.getAllDrawPanes?.()||[]){
    const el=target.getDom?.(pane.getId(),'yAxis');if(!el)continue;
    el.dataset.axis='price';el.dataset.pane=pane.getId();el.title='滚轮缩放价格，双击恢复自动范围';
  }
}
function setupChart() {
  registerLocalOverlays();
  chart = init('chart'); styleChart(chart); bindPriceAxisWheel(chart);
  chart.subscribeAction('onCrosshairChange', data => {
    if (data?.kLineData) renderOhlc(data.kLineData);
    if (data?.paneId==='candle_pane' && Number.isFinite(data.y)) {
      const price=chart.getDrawPaneById?.('candle_pane')?.getAxisComponent?.()?.convertFromPixel?.(data.y);
      if (Number.isFinite(price)&&price>0) chartPointer.price=price;
      if (Number.isFinite(data.kLineData?.timestamp)) chartPointer.timestamp=data.kLineData.timestamp;
    }
  });
  chart.setLoadDataCallback(({callback}) => callback([],false));
  new ResizeObserver(() => {chart.resize();secondaryChart?.resize();}).observe($('#chart-area'));
  syncIndicators();
}
function syncIndicators() {
  for (const [name,pane] of subPanes) if (!state.indicators.includes(name)) {chart.removeIndicator(pane,name);subPanes.delete(name);}
  for (const name of state.indicators) {
    if (!supportedIndicators.includes(name) || subPanes.has(name)) continue;
    const config = {name, ...(state.indicatorParams[name]?{calcParams:state.indicatorParams[name]}:{})};
    const pane = chart.createIndicator(config,true,onPricePane.has(name)?{id:'candle_pane'}:{id:`indicator_${name}`,height:name==='VOL'?75:95,minHeight:40});
    subPanes.set(name,pane || 'candle_pane');
  }
  $('#indicator-chips').innerHTML = state.indicators.map(name => `<span class="indicator-chip"><i></i><button data-edit-indicator="${esc(name)}" title="调整参数">${esc(name)} ${esc((state.indicatorParams[name]||[]).join(' / '))}</button><button data-remove-indicator="${esc(name)}" aria-label="移除 ${esc(name)}">×</button></span>`).join('');
  $$('[data-remove-indicator]').forEach(button => button.onclick = () => toggleIndicator(button.dataset.removeIndicator));
  $$('[data-edit-indicator]').forEach(button => button.onclick = () => indicatorParameters(button.dataset.editIndicator));
  if(chart)markPriceAxes(chart);
}
function toggleIndicator(name) {
  state.indicators = state.indicators.includes(name)?state.indicators.filter(value=>value!==name):[...state.indicators,name];
  syncIndicators(); scheduleSave();
}
function applyTheme() {
  document.body.classList.toggle('light',state.theme==='light');
  $('#theme-button').innerHTML = icon(state.theme==='light'?'moon':'sun');
  if(chart)styleChart(chart);if(secondaryChart)styleChart(secondaryChart);
}
function renderOhlc(bar) {
  if (!bar) return;
  $('#ohlc-row').innerHTML = [['开',bar.open],['高',bar.high],['低',bar.low],['收',bar.close]].map(([label,value])=>`<span>${label}<b class="${sign(bar.close-bar.open)}">${fmt(value)}</b></span>`).join('')+`<span>量<b>${fmt(bar.volume,0)}</b></span>`;
}
function delayLabel(meta) {if(!state.autoRefresh&&meta?.provider!=='csv')return '暂停更新';if(meta?.cache==='stale')return '离线缓存';if(meta?.provider==='csv')return '本地 CSV';if(meta?.feedType==='push')return meta.sourceTime>Date.now()+5000?'源时间待核对':Date.now()-meta.sourceTime>15000?'推送未更新':streamState==='live'?'实时推送':streamState==='reconnecting'?'推送重连中':'等待推送';if(meta?.feedType==='poll')return `公开报价 · ${Math.round((meta.pollIntervalMs||3000)/1000)}秒轮询`;return meta?.delayMinutes>0?`延迟 ${meta.delayMinutes} 分钟`:meta?.delayMinutes===0?'在线快照':'延迟未确认'; }
function renderHeader() {
  const item = currentInstrument(), bars = visibleCandles(), last = bars.at(-1);
  const quote = replay ? {price:last?.close,change:last?.close-bars[0]?.close,changePercent:bars.length?(last.close/bars[0].close-1)*100:null} : payload?.quote;
  $('#symbol-label').textContent=state.symbol;$('#symbol-mark').innerHTML=symbolMark(state.symbol);$('#instrument-name').textContent=item.name;$('#instrument-badge').innerHTML=symbolMark(state.symbol);activateSymbolMarks($('#symbol-mark'));activateSymbolMarks($('#instrument-badge'));
  $('#instrument-meta').textContent=`${payload?.meta.exchange||item.exchange||marketNames[item.market]||'本地'} · ${payload?.meta.currency||item.currency||''} · ${delayLabel(liveMeta||payload?.meta)}`;
  $('#interval-label').textContent=state.interval.toUpperCase();
  $('#last-price').textContent=fmt(quote?.price);$('#last-price').className=sign(quote?.change);
  $('#price-change').textContent=`${Number.isFinite(quote?.change)?(quote.change>=0?'+':'')+fmt(quote.change):'—'}  ${pct(quote?.changePercent/100)}`;
  $('#price-change').className=sign(quote?.change);
  renderOhlc(last);
  $$('#periods button').forEach(button=>button.classList.toggle('selected',button.dataset.interval===state.interval));
  const age=payload?.quote?.timestamp?Math.max(0,Date.now()-payload.quote.timestamp):null;
  $('#connection-status').textContent=replay?'历史回放':`${delayLabel(liveMeta||payload?.meta)}${age!==null?payload.quote.timestamp>Date.now()+5000?' · 源时间晚于本机':` · 报价距今 ${age<60000?Math.floor(age/1000)+'秒':Math.floor(age/60000)+'分钟'}`:''}`;
  $('#connection-dot').style.background=payload?.meta.cache==='stale'||age>20000||streamState==='reconnecting'?'#d5aa62':'';
  $('#data-status').textContent=`${payload?.meta.providerName||'数据源'} · ${bars.length} 根 K线 · ${state.interval.toUpperCase()}`;
  const first=bars[0];const min=bars.length?Math.min(...bars.map(b=>b.low)):null,max=bars.length?Math.max(...bars.map(b=>b.high)):null;
  $('#instrument-detail').innerHTML=`<h3>${esc(item.name)}</h3><div class="detail-price ${sign(quote?.change)}">${fmt(quote?.price)}</div><div class="detail-change ${sign(quote?.change)}">${pct(quote?.changePercent/100)} <span class="muted">${replay?'回放区间':quote?.changePeriod==='rolling-24h'?'24 小时':'源报价涨跌幅'}</span></div><div class="detail-stats"><div><label>区间最高</label><strong>${fmt(max)}</strong></div><div><label>区间最低</label><strong>${fmt(min)}</strong></div><div><label>载入 K 线</label><strong>${bars.length}</strong></div><div><label>起始交易日</label><strong>${first?shortDate(first.timestamp):'—'}</strong></div></div><p class="detail-source">${esc(liveMeta?.providerName||payload?.meta.providerName||'—')} · ${esc(delayLabel(liveMeta||payload?.meta))}<br>报价时间 ${esc(date(quote?.timestamp||last?.timestamp))}</p>`;
}
function renderWatchlist() {
  const list=state.watchlist.filter(enabledSymbol).map(symbol=>catalog.find(item=>item.symbol===symbol)||{symbol,name:symbol,market:state.imports[symbol]?'local':'us'}).filter(item=>marketFilter==='all'||(marketFilter==='etf'?item.type==='etf':item.market===marketFilter||marketFilter==='futures'&&item.market==='cn-futures'));
  $('#watchlist').innerHTML=list.length?list.map(item=>{const quote=quotes.get(item.symbol);return `<div class="watch-row ${item.symbol===state.symbol?'selected':''}" role="button" tabindex="0" draggable="true" data-watch="${esc(item.symbol)}"><span class="watch-name">${symbolMark(item.symbol)}<span><span class="ticker">${esc(item.symbol)}</span><span class="company">${esc(item.name)}</span></span></span><span class="watch-price">${fmt(quote?.price)}</span><span class="watch-change ${sign(quote?.change)}">${pct(quote?.changePercent/100)}</span><button class="remove-watch" data-remove-watch="${esc(item.symbol)}" aria-label="从自选移除 ${esc(item.symbol)}">×</button></div>`}).join(''):'<p class="search-hint" style="padding:15px">这个市场还没有自选，点右上角 + 添加。</p>';
  activateSymbolMarks($('#watchlist'));
  $$('[data-watch]').forEach(row=>{
    row.ondragstart=event=>{row.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',row.dataset.watch);};
    row.ondragover=event=>{event.preventDefault();row.classList.add('drag-over');};
    row.ondragleave=()=>row.classList.remove('drag-over');
    row.ondrop=event=>{
      event.preventDefault();row.classList.remove('drag-over');
      const from=event.dataTransfer.getData('text/plain');const to=row.dataset.watch;
      if(!from||from===to)return;
      const next=state.watchlist.filter(symbol=>symbol!==from);const index=next.indexOf(to);if(index<0)return;
      next.splice(index,0,from);state.watchlist=next;renderWatchlist();scheduleSave();
    };
    row.ondragend=()=>row.classList.remove('dragging');
    row.onclick=event=>{if(event.target.closest('[data-remove-watch]')||row.classList.contains('dragging'))return;selectSymbol(row.dataset.watch)};
    row.onkeydown=event=>{if(event.key==='Enter')selectSymbol(row.dataset.watch)};
    row.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();openWatchMenu(event.clientX,event.clientY,row.dataset.watch);};
  });
  $$('[data-remove-watch]').forEach(button=>button.onclick=event=>{event.stopPropagation();state.watchlist=state.watchlist.filter(symbol=>symbol!==button.dataset.removeWatch);renderWatchlist();scheduleSave();});
}
async function refreshWatchlist() {
  const queue=state.watchlist.filter(symbol=>enabledSymbol(symbol)&&!state.imports[symbol]);
  await Promise.all(Array.from({length:3},async()=>{
    while(queue.length){const symbol=queue.shift();try{const value=await api(`/api/candles?${new URLSearchParams({symbol,interval:'1d',limit:2})}`);if(!quotes.get(symbol)?.timestamp||value.quote.timestamp>=quotes.get(symbol).timestamp)quotes.set(symbol,value.quote);renderWatchlist();}catch{/* A missing quote stays explicitly blank. */}}
  }));
}
function registerLocalOverlays(){
  registerChartOverlays(registerOverlay);
  registerOverlay({name:'localNote',totalStep:2,needDefaultPointFigure:true,createPointFigures:({overlay,coordinates})=>{
    const point=coordinates[0];if(!point)return [];
    const text=typeof overlay.extendData==='string'&&overlay.extendData?overlay.extendData:'标注';
    return [{type:'line',attrs:{coordinates:[{x:point.x,y:point.y},{x:point.x,y:point.y-36}]}},{type:'text',attrs:{x:point.x,y:point.y-40,text,align:'center',baseline:'bottom'}}];
  }});
  registerOverlay({name:'rect',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay})=>{
    if(coordinates.length<2)return [];
    const x=Math.min(coordinates[0].x,coordinates[1].x),y=Math.min(coordinates[0].y,coordinates[1].y);
    return [{type:'rect',attrs:{x,y,width:Math.abs(coordinates[1].x-coordinates[0].x),height:Math.abs(coordinates[1].y-coordinates[0].y)},styles:{style:'stroke_fill',borderColor:overlay.styles?.line?.color||'#d4a94e',borderSize:overlay.styles?.line?.size||1,color:'rgba(212,169,78,0.12)'}}];
  }});
}
function drawingKey(){return `${state.symbol}|${state.interval}`;}
function serializeDrawings(){
  if(!chart||!payload||restoringDrawings)return;
  state.drawings[drawingKey()]=[...drawingIds].map(id=>chart.getOverlayById(id)).filter(overlay=>overlay&&overlay.id!==pendingDrawing&&!overlay.isDrawing?.()).map(overlay=>({id:overlay.id,name:overlay.name,points:overlay.points.map(({timestamp,dataIndex,value})=>({...Number.isFinite(timestamp)?{timestamp}:{dataIndex},value})),...(overlay.styles?{styles:overlay.styles}:{}),...(overlay.extendData!==undefined?{extendData:overlay.extendData}:{}),visible:drawingVisibility.get(overlay.id)!==false,lock:overlay.lock}));
  const host=$('#chart');if(host)host.dataset.drawingCount=String(state.drawings[drawingKey()].length);
}
const drawingNames={...DRAWING_NAMES,simpleAnnotation:'文字'};
function showSelection(overlay){
  selectedDrawing=overlay?.id||'';
  const bar=$('#drawing-selection');if(!bar)return;
  bar.classList.toggle('hidden',!selectedDrawing);
  if(!selectedDrawing)return;
  $('#drawing-selection-label').textContent=drawingNames[overlay.name]||overlay.name;
  $('#drawing-lock').innerHTML=icon(overlay.lock?'unlock':'lock');
  $('#drawing-lock').title=overlay.lock?'解锁':'锁定';
  $('#drawing-lock').setAttribute('aria-label',$('#drawing-lock').title);
  const color=overlay.styles?.line?.color;
  if(typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color))$('#drawing-color').value=color;
  $('#drawing-width').value=String(overlay.styles?.line?.size||1);
  $('#drawing-line-style').value=overlay.styles?.line?.style||'solid';
  $('#drawing-edit-text').classList.toggle('hidden',!['localNote','simpleAnnotation','simpleTag'].includes(overlay.name));
  const host=$('#chart');if(host)host.dataset.selectedDrawing=selectedDrawing;
}
function hideSelection(id){
  if(id&&id!==selectedDrawing)return;
  selectedDrawing='';$('#drawing-selection')?.classList.add('hidden');
  const host=$('#chart');if(host)host.dataset.selectedDrawing='';
}
function placeOverlay(config){
  const created=chart.createOverlay({groupId:'user-drawings',mode:magnet,...config,...drawingCallbacks()});
  const id=Array.isArray(created)?created[0]:created;
  if(id){drawingIds.add(id);drawingVisibility.set(id,config.visible!==false);if(drawingsHidden)chart.overrideOverlay({id,visible:false});}
  return id;
}
function drawingCallbacks(){return {
  onDrawEnd:({overlay})=>{if(restoringDrawings)return false;pendingDrawing='';drawingIds.add(overlay.id);const again=currentTool;if(drawingsLocked)chart.overrideOverlay({id:overlay.id,lock:true});currentTool='';commitDrawings();renderDrawingTools();if(keepDrawing&&again&&again!=='localNote')setTimeout(()=>beginDrawing(again,false),0);return false;},
  onPressedMoveEnd:()=>{commitDrawings();return false;},
  onRemoved:({overlay})=>{if(restoringDrawings)return false;drawingIds.delete(overlay.id);drawingVisibility.delete(overlay.id);hideSelection(overlay.id);queueMicrotask(()=>commitDrawings());return false;},
  onRightClick:event=>{showSelection(event.overlay);drawingMenuFromOverlay=true;openChartMenu(event.pageX??event.x??0,event.pageY??event.y??0,'drawing');queueMicrotask(()=>{drawingMenuFromOverlay=false;});return true;},
  onSelected:({overlay})=>{if(overlay.groupId==='user-drawings')showSelection(overlay);return false;},
  onDeselected:({overlay})=>{hideSelection(overlay.id);return false;},
};}
function restoreDrawings(){
  const saved=structuredClone(state.drawings[drawingKey()]||[]),wanted=new Set(saved.map(d=>d.id));restoringDrawings=true;
  try{
    for(const id of [...drawingIds])if(!wanted.has(id)&&id!==pendingDrawing){chart.removeOverlay(id);drawingIds.delete(id);}
    for(const overlay of saved)if(getSupportedOverlays().includes(overlay.name)){
      drawingVisibility.set(overlay.id,overlay.visible!==false);
      const config={...overlay,groupId:'user-drawings',...drawingCallbacks(),lock:connection?.role==='reader'||overlay.lock,visible:!drawingsHidden&&overlay.visible!==false};
      if(chart.getOverlayById(overlay.id))chart.overrideOverlay(config);else{const id=chart.createOverlay(config);if(id)drawingIds.add(id);}
    }
  }finally{restoringDrawings=false;}
  drawSharedNotes();
  updateDrawingActions();
}
function scheduleSave(){if(sharedApplying)return;collaboration?.schedule();connectMarket();clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveState(false),800);}
async function saveState(show=true){
  serializeDrawings();
  try{if(connection?.local)await api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});else localStorage.setItem('shanhai-workspace',JSON.stringify(state));await collaboration?.flush();if(show)toast(collaboration?.conflicts.length?'本地草稿已保存，请在协作面板处理冲突。':collaboration?.retryBatch?'本地草稿已保存，共享修改正在重试。':'工作区与协作图表已保存。');return true;}
  catch(error){toast(`保存失败：${error.message}`);return false;}
}
function removeComputed(){
  chart.removeOverlay({groupId:'backtest-signals'});chart.removeOverlay({groupId:'pine-signals'});
  chart.removeIndicator('candle_pane','LOCAL_PINE_OVERLAY');chart.removeIndicator('pine_pane','LOCAL_PINE_PANE');
  pineResult=null;backtestResult=null;
}
async function loadSymbol({refresh=false}={}){
  cancelDrawing();hideSelection();
  const id=++loadingId;const symbol=state.symbol,interval=state.interval;
  $('#connection-status').textContent='正在获取行情…';$('#chart-message').classList.remove('hidden');$('#chart-message').textContent=`正在获取 ${symbol} · ${interval.toUpperCase()} 的真实行情…`;
  payload=null;liveMeta=null;allCandles=[];liveFeed.close();removeComputed();chart.applyNewData([],false);if(['backtest','data','collab'].includes(activeTab))renderPanel();
  try{
    const value=state.imports[symbol]||await api(`/api/candles?${new URLSearchParams({symbol,interval,limit:800,...(refresh?{refresh:'1'}:{})})}`);
    if(id!==loadingId)return;
    payload=value;allCandles=value.candles;quotes.set(symbol,value.quote);chart.setPriceVolumePrecision(allCandles.at(-1).close<1?6:allCandles.at(-1).close<10?4:2,0);
    chart.applyNewData(allCandles,false);chart.setBarSpace(7.5);chart.scrollToRealTime();if(!refresh)resetPriceScale(chart);rememberAxis(chart);restoreDrawings();
    serializeDrawings();drawingHistory.observe(drawingKey(),state.drawings[drawingKey()]||[]);updateDrawingActions();
    $('#chart-message').classList.add('hidden');renderHeader();renderWatchlist();refreshAgentButton();if(activeTab!=='accounts')renderPanel();
    if(state.dual)loadSecondary();connectMarket();scheduleSave();
  }catch(error){
    if(id!==loadingId)return;
    $('#chart-message').innerHTML=`${esc(error.message)}<br><button class="secondary" id="retry-feed">重试</button> <button class="secondary" id="import-feed">导入 CSV</button>`;
    $('#retry-feed').onclick=()=>loadSymbol({refresh:true});$('#import-feed').onclick=()=>$('#csv-file').click();
    $('#connection-status').textContent='行情暂不可用';$('#instrument-meta').textContent=error.message;
    $('#last-price').textContent='—';$('#price-change').textContent='—';$('#data-status').textContent=`${symbol} · ${interval.toUpperCase()} · 暂无数据`;
    if(activeTab!=='accounts')renderPanel();
  }
}
async function selectSymbol(symbol){
  if(symbol===state.symbol)return;
  serializeDrawings();exitReplay(false);stopPine();state.symbol=symbol;renderWatchlist();$('#symbol-label').textContent=symbol;
  if(!state.watchlist.includes(symbol))state.watchlist.push(symbol);
  await loadSymbol();
}
async function selectInterval(interval){
  if(interval===state.interval)return;
  if(state.imports[state.symbol]){toast('CSV 数据按导入周期显示；需要其他周期时请导入对应数据。');return;}
  serializeDrawings();exitReplay(false);stopPine();state.interval=interval;await loadSymbol();
}
async function loadSecondary({refresh=false}={}){
  if(!state.dual)return;
  const symbol=state.symbol,interval=state.secondaryInterval;
  try{
    const value=state.imports[symbol]||await api(`/api/candles?${new URLSearchParams({symbol,interval,limit:800,...(refresh?{refresh:'1'}:{})})}`);
    if(!state.dual||symbol!==state.symbol||interval!==state.secondaryInterval)return;
    const last=secondaryChart.getDataList().at(-1);
    if(refresh&&last&&value.candles.some(bar=>bar.timestamp===last.timestamp)){for(const bar of value.candles.filter(bar=>bar.timestamp>=last.timestamp))secondaryChart.updateData(bar);}else{secondaryChart.applyNewData(value.candles,false);secondaryChart.setBarSpace(5);secondaryChart.scrollToRealTime();}
  }catch(error){toast(`对照图：${error.message}`);secondaryChart?.applyNewData([],false);}
}
function toggleLayout(){
  if(replay){toast('请先退出回放，再切换双图布局。');return;}
  state.dual=!state.dual;$('#chart-area').classList.toggle('dual',state.dual);$('#chart-secondary').classList.toggle('hidden',!state.dual);
  if(state.dual){secondaryChart=init('chart-secondary');styleChart(secondaryChart);bindPriceAxisWheel(secondaryChart);secondaryChart.createIndicator('VOL',false,{height:75});
    const controls=document.createElement('div');controls.id='secondary-controls';controls.className='secondary-controls';controls.innerHTML=`<span>同标的对照</span><select id="secondary-interval" aria-label="对照图周期">${['5m','15m','30m','1h','4h','1d','1w'].map(value=>`<option ${value===state.secondaryInterval?'selected':''}>${value}</option>`).join('')}</select>`;$('#chart-area').append(controls);$('#secondary-interval').onchange=event=>{state.secondaryInterval=event.target.value;loadSecondary();scheduleSave();};loadSecondary();
  }else{dispose('chart-secondary');secondaryChart=null;$('#secondary-controls')?.remove();}
  $('#layout-button').classList.toggle('active',state.dual);chart.resize();scheduleSave();
}

function updateDrawingActions(){
  const values=state.drawings[drawingKey()]||[];
  drawingsLocked=values.length>0&&values.every(item=>item.lock);
  if($('#undo-drawing'))$('#undo-drawing').disabled=connection?.role==='reader'||!drawingHistory.canUndo(drawingKey());
  if($('#redo-drawing'))$('#redo-drawing').disabled=connection?.role==='reader'||!drawingHistory.canRedo(drawingKey());
}
function commitDrawings(){
  if(restoringDrawings||!payload)return;
  serializeDrawings();drawingHistory.record(drawingKey(),state.drawings[drawingKey()]||[]);
  updateDrawingActions();if($('#drawing-object-list'))renderDrawingObjects();scheduleSave();
}
function canEditDrawings(){
  if(connection?.role==='reader'){toast('当前为只读访问；编辑图表需要编辑凭据。');return false;}
  return true;
}
function cancelDrawing(){
  closeDrawingMenu();
  if(pendingDrawing){const id=pendingDrawing;pendingDrawing='';restoringDrawings=true;try{chart.removeOverlay(id);drawingIds.delete(id);drawingVisibility.delete(id);}finally{restoringDrawings=false;}}
  currentTool='';renderDrawingTools();
}
function beginDrawing(name,announce=true){
  cancelDrawing();if(!name)return;
  if(!canEditDrawings())return;
  if(!allCandles.length){toast('请先载入行情。');return;}
  if(!getSupportedOverlays().includes(name)){toast('当前画图引擎不支持这个工具。');return;}
  if((state.drawings[drawingKey()]||[]).length>=200){toast('当前图表最多保存 200 个图形。');return;}
  let extendData;
  if(name==='localNote'){extendData=prompt('输入标注文字','关注价位');if(!extendData?.trim())return;extendData=extendData.trim().slice(0,1000);}
  if(drawingsHidden)toggleDrawingVisibility();
  const choice=drawingChoice(name);if(choice){toolChoices[choice.group]=name;localStorage.setItem('shanhai-drawing-tools',JSON.stringify(toolChoices));}
  currentTool=name;pendingDrawing=placeOverlay({name,...(extendData?{extendData}:{})});hidePricePlus();renderDrawingTools();
  if(announce)toast(`${drawingNames[name]||name}：在图上点击放置锚点，Esc 取消。`);
}
function mutateDrawings(action){
  if(!canEditDrawings()||!payload)return;
  cancelDrawing();restoringDrawings=true;
  try{action();}finally{restoringDrawings=false;}
  commitDrawings();renderDrawingTools();
}
function undoDrawings(redo=false){
  if(!canEditDrawings()||!payload)return;
  cancelDrawing();const next=redo?drawingHistory.redo(drawingKey()):drawingHistory.undo(drawingKey());if(!next)return;
  state.drawings[drawingKey()]=next;hideSelection();restoreDrawings();serializeDrawings();renderDrawingTools();
  if($('#drawing-object-list'))renderDrawingObjects();scheduleSave();
}
function toggleDrawingVisibility(){
  drawingsHidden=!drawingsHidden;localStorage.setItem('shanhai-hide-drawings',drawingsHidden?'1':'0');
  for(const id of drawingIds)chart.overrideOverlay({id,visible:!drawingsHidden&&drawingVisibility.get(id)!==false});
  if(drawingsHidden)hideSelection();renderDrawingTools();
}
function removeSelectedDrawing(){
  if(!selectedDrawing)return;const id=selectedDrawing;
  mutateDrawings(()=>{chart.removeOverlay(id);drawingIds.delete(id);drawingVisibility.delete(id);hideSelection();});
}
function copySelectedDrawing(){
  const overlay=chart.getOverlayById(selectedDrawing);if(!overlay)return;
  chartClipboard={kind:'drawing',drawing:snapshotOverlay(overlay)};
  mutateDrawings(()=>{const points=overlay.points.map(point=>({...point,...(Number.isFinite(point.value)?{value:point.value*1.003}:{})}));placeOverlay({name:overlay.name,points,extendData:overlay.extendData,styles:overlay.styles,lock:false});});
}
function editDrawingText(){
  const overlay=chart.getOverlayById(selectedDrawing);if(!overlay||!canEditDrawings())return;
  const text=prompt('编辑标注文字',String(overlay.extendData||''));if(text===null||!text.trim())return;
  mutateDrawings(()=>chart.overrideOverlay({id:overlay.id,extendData:text.trim().slice(0,1000)}));
}
function renderDrawingTools(){
  renderDrawingToolbar({host:$('#drawing-tools'),active:currentTool,choices:toolChoices,magnet,keepDrawing,locked:drawingsLocked,hidden:drawingsHidden,readonly:connection?.role==='reader',onSelect:beginDrawing,onAction:id=>{
    if(id==='magnet-tool'){magnet={normal:'weak_magnet',weak_magnet:'strong_magnet',strong_magnet:'normal'}[magnet];chart.overrideOverlay({groupId:'user-drawings',mode:magnet});renderDrawingTools();}
    else if(id==='keep-drawing-tool'){keepDrawing=!keepDrawing;localStorage.setItem('shanhai-keep-drawing',keepDrawing?'1':'0');renderDrawingTools();}
    else if(id==='lock-tool')mutateDrawings(()=>chart.overrideOverlay({groupId:'user-drawings',lock:!drawingsLocked}));
    else if(id==='hide-drawings-tool')toggleDrawingVisibility();
    else if(id==='drawing-manager-tool')openDrawingManager();
    else if(id==='shortcuts-tool')openShortcuts();
    else if(id==='alert-tool')setTab('alerts');
    else if(id==='delete-drawings')mutateDrawings(()=>{chart.removeOverlay({groupId:'user-drawings'});drawingIds.clear();drawingVisibility.clear();hideSelection();});
  }});
  updateDrawingActions();
}
function openDrawingManager(){
  cancelDrawing();serializeDrawings();
  openModal('图形对象管理',`<p class="drawing-manager-caption">${esc(state.symbol)} · ${esc(state.interval.toUpperCase())} · 点击名称定位图形</p><div id="drawing-object-list"></div>`);
  renderDrawingObjects();
}
function renderDrawingObjects(){
  const values=state.drawings[drawingKey()]||[],readonly=connection?.role==='reader';
  $('#drawing-object-list').innerHTML=values.length?values.map(item=>`<div class="drawing-object"><button class="object-name" data-object-focus="${esc(item.id)}"><strong>${esc(drawingNames[item.name]||item.name)}</strong><small>${esc(typeof item.extendData==='string'?item.extendData:item.points.map(point=>fmt(point.value)).join(' → '))}</small></button><button class="icon-button" data-object-visible="${esc(item.id)}" title="${item.visible===false?'显示':'隐藏'}图形" aria-label="${item.visible===false?'显示':'隐藏'}图形" ${readonly?'disabled':''}>${icon(item.visible===false?'eyeOff':'eye')}</button><button class="icon-button" data-object-lock="${esc(item.id)}" title="${item.lock?'解锁':'锁定'}图形" aria-label="${item.lock?'解锁':'锁定'}图形" ${readonly?'disabled':''}>${icon(item.lock?'lock':'unlock')}</button><button class="icon-button" data-object-remove="${esc(item.id)}" aria-label="删除图形" title="删除图形" ${readonly?'disabled':''}>${icon('trash')}</button></div>`).join(''):'<p class="search-hint object-empty">当前图表还没有图形。使用左侧工具开始绘图。</p>';
  $$('[data-object-focus]').forEach(button=>button.onclick=()=>{const overlay=chart.getOverlayById(button.dataset.objectFocus);if(!overlay)return;if(overlay.points[0]?.timestamp)chart.scrollToTimestamp(overlay.points[0].timestamp);$('#modal').close();if(overlay.visible)showSelection(overlay);else toast('该图形已隐藏，可在对象管理中显示。');});
  $$('[data-object-visible]').forEach(button=>button.onclick=()=>mutateDrawings(()=>{const id=button.dataset.objectVisible,visible=drawingVisibility.get(id)===false;drawingVisibility.set(id,visible);chart.overrideOverlay({id,visible:!drawingsHidden&&visible});if(!visible)hideSelection(id);}));
  $$('[data-object-lock]').forEach(button=>button.onclick=()=>mutateDrawings(()=>{const id=button.dataset.objectLock,overlay=chart.getOverlayById(id);chart.overrideOverlay({id,lock:!overlay.lock});}));
  $$('[data-object-remove]').forEach(button=>button.onclick=()=>mutateDrawings(()=>{const id=button.dataset.objectRemove;chart.removeOverlay(id);drawingIds.delete(id);drawingVisibility.delete(id);hideSelection(id);}));
}
function openShortcuts(){
  openModal('快捷键',`<div class="shortcut-list">${SHORTCUTS.map(item=>`<div><span>${esc(item.label)}</span><kbd>${esc(item.display)}</kbd></div>`).join('')}</div><p class="search-hint">输入框和编辑器保留原生编辑快捷键。方向键平移，加号减号缩放，逗号和句号切换周期。绘图历史按品种与周期分别记录。</p>`);
}
function applyChartPreferences(next){
  Object.assign(chartPreferences,normalizeChartPreferences({...chartPreferences,...next}));
  localStorage.setItem('shanhai-chart-preferences',JSON.stringify(chartPreferences));
  for(const target of [chart,secondaryChart])if(target){styleChart(target);resetPriceScale(target);}
}
function openChartSettings(){
  closeChartMenu();
  const p=chartPreferences;
  openModal('图表设置',`<form id="chart-settings-form" class="chart-settings"><label>价格刻度<select name="scale" aria-label="价格刻度类型"><option value="normal" ${p.scale==='normal'?'selected':''}>线性</option><option value="log" ${p.scale==='log'?'selected':''}>对数</option><option value="percentage" ${p.scale==='percentage'?'selected':''}>百分比</option></select></label>${[['grid','显示网格线'],['crosshair','显示十字光标'],['lastPrice','显示最新价标记'],['reverse','反转价格轴'],['watermark','显示图表水印']].map(([key,label])=>`<label class="setting-switch"><span>${label}</span><input type="checkbox" name="${key}" ${p[key]?'checked':''}></label>`).join('')}<div class="settings-actions"><button type="button" class="quiet" id="reset-chart-settings">恢复默认</button><button class="primary">应用设置</button></div></form><p class="search-hint">外观设置保存在本机浏览器，适用于主图和对照图。对数刻度适合正价格序列。</p>`);
  $('#chart-settings-form').onsubmit=event=>{event.preventDefault();const values=new FormData(event.target);applyChartPreferences({scale:values.get('scale'),...Object.fromEntries(['grid','crosshair','lastPrice','reverse','watermark'].map(key=>[key,values.has(key)]))});$('#modal').close();};
  $('#reset-chart-settings').onclick=()=>{applyChartPreferences(DEFAULT_CHART_PREFERENCES);openChartSettings();};
}
async function toggleFullscreen(){
  closeChartMenu();
  try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#app').requestFullscreen)await $('#app').requestFullscreen();else toast('当前浏览器不支持全屏。');}catch(error){toast(`全屏未开启：${error.message}`);}
}
let chartContextMenu=null,drawingMenuFromOverlay=false;
function closeChartMenu(){chartContextMenu?.remove();chartContextMenu=null;}
function fitChart(){if(!chart)return;chart.setBarSpace(Math.max(1,($('#chart').clientWidth-80)/(visibleCandles().length||1)));chart.scrollToRealTime();resetPriceScale(chart);}
function priceAtClientY(clientY){
  const axisEl=chart?.getDom?.('candle_pane','yAxis');
  const axis=chart?.getDrawPaneById?.('candle_pane')?.getAxisComponent?.();
  if(!axis||!axisEl||!Number.isFinite(clientY))return null;
  const value=axis.convertFromPixel?.(clientY-axisEl.getBoundingClientRect().top);
  return Number.isFinite(value)&&value>0?value:null;
}
function latestPrice(){
  const price=Number(payload?.quote?.price??allCandles.at(-1)?.close);
  return Number.isFinite(price)&&price>0?price:null;
}
function barAtClientX(clientX){
  const main=chart?.getDom?.('candle_pane','main');
  if(!chart?.convertFromPixel||!main||!Number.isFinite(clientX))return null;
  const point=chart.convertFromPixel({x:clientX-main.getBoundingClientRect().left},{paneId:'candle_pane'});
  const index=Math.round(Number(point?.dataIndex));
  const list=chart.getDataList?.()||[];
  return Number.isInteger(index)&&index>=0&&index<list.length?list[index]:null;
}
function rememberPointer(clientX,clientY){
  const yPrice=priceAtClientY(clientY);
  const bar=barAtClientX(clientX);
  if(Number.isFinite(yPrice))chartPointer.price=yPrice;
  if(Number.isFinite(bar?.timestamp))chartPointer.timestamp=bar.timestamp;
  return {price:Number.isFinite(yPrice)?yPrice:latestPrice(),timestamp:Number.isFinite(bar?.timestamp)?bar.timestamp:(Number.isFinite(chartPointer.timestamp)?chartPointer.timestamp:null)};
}
function resetChartView(){if(!chart)return;resetPriceScale(chart);chart.setBarSpace(7.5);chart.scrollToRealTime();}
function hidePricePlus(){$('#price-plus')?.classList.add('hidden');}
function movePricePlus(event){
  const plus=$('#price-plus');
  if(!plus||!chart||chartContextMenu||currentTool||pendingDrawing){hidePricePlus();return;}
  const main=chart.getDom?.('candle_pane','main');if(!main){hidePricePlus();return;}
  const box=main.getBoundingClientRect(),area=$('#chart-area').getBoundingClientRect();
  const overPlus=Boolean(event.target?.closest?.('#price-plus'));
  const inside=event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom;
  if(!inside&&!overPlus){hidePricePlus();return;}
  const raw=overPlus?Number(plus.dataset.clientY):event.clientY;
  const y=Math.min(box.bottom-12,Math.max(box.top+12,raw));
  const price=priceAtClientY(y);
  if(!Number.isFinite(price)){hidePricePlus();return;}
  plus.dataset.clientY=String(y);plus.classList.remove('hidden');
  const label=$('#price-plus-label');if(label)label.textContent=fmt(price);
  plus.style.top=`${y-area.top}px`;
  plus.style.left=`${Math.max(box.left-area.left,box.right-area.left-plus.offsetWidth-1)}px`;
  chartPointer.price=price;
  const bar=barAtClientX(Math.min(Math.max(event.clientX,box.left+1),box.right-1));
  if(Number.isFinite(bar?.timestamp))chartPointer.timestamp=bar.timestamp;
}
function plainClone(value){try{return JSON.parse(JSON.stringify(value));}catch{return value;}}
function snapshotOverlay(overlay){
  if(!overlay?.name)return null;
  return {name:overlay.name,points:(overlay.points||[]).map(({timestamp,dataIndex,value})=>({...(Number.isFinite(timestamp)?{timestamp}:{dataIndex}),...(Number.isFinite(value)?{value}:{})})),...(overlay.styles?{styles:plainClone(overlay.styles)}:{}),...(overlay.extendData!==undefined?{extendData:plainClone(overlay.extendData)}:{}),lock:false,visible:true};
}
function copyMenuPrice(price){
  if(!Number.isFinite(price)){toast('没有可复制的内容。');return;}
  const text=fmt(price);
  chartClipboard={kind:'price',price};
  toast(`已复制 ${text}`);
  navigator.clipboard?.writeText(text).catch(()=>{});
}
function placeHorizontalLine(price){
  if(!canEditDrawings())return;
  const value=Number(price);
  if(!Number.isFinite(value)||value<=0||!allCandles.length){toast('当前没有可标注的价格。');return;}
  if(userDrawingCount()>=200){toast('当前图表最多保存 200 个图形。');return;}
  mutateDrawings(()=>placeOverlay({name:'horizontalStraightLine',points:[{timestamp:allCandles.at(-1).timestamp,value}]}));
  toast(`已在 ${fmt(value)} 添加水平线。`);
}
function pasteChartClipboard(){
  if(!chartClipboard)return;
  if(chartClipboard.kind==='price'){placeHorizontalLine(chartClipboard.price);return;}
  const drawing=plainClone(chartClipboard.drawing);
  if(!drawing?.name||!canEditDrawings())return;
  drawing.points=(drawing.points||[]).map(point=>({...point,...(Number.isFinite(point.value)?{value:point.value*1.003}:{})}));
  drawing.lock=false;mutateDrawings(()=>placeOverlay(drawing));toast('已粘贴画线。');
}
function addPriceAlert(price){const saved=placePriceAlert(price);if(saved)setTab('alerts');return saved;}
function userDrawingCount(){return [...drawingIds].filter(id=>id&&id!==pendingDrawing&&chart?.getOverlayById?.(id)).length;}
function removeAllDrawings(){mutateDrawings(()=>{chart.removeOverlay({groupId:'user-drawings'});drawingIds.clear();drawingVisibility.clear();hideSelection();});}
function removeAllIndicators(){
  if(connection?.role==='reader'){toast('当前为只读访问；编辑图表需要编辑凭据。');return;}
  state.indicators=[];syncIndicators();scheduleSave();toast('已移除全部指标。');
}
function toggleCursorLock(timestamp){
  if(!canEditDrawings()||!chart)return;
  if(chart.getOverlayById('cursor-time-lock')){
    mutateDrawings(()=>{chart.removeOverlay('cursor-time-lock');drawingIds.delete('cursor-time-lock');drawingVisibility.delete('cursor-time-lock');hideSelection('cursor-time-lock');});
    toast('已解除垂直光标线。');return;
  }
  const time=Number(timestamp);
  if(!Number.isFinite(time)||!allCandles.length){toast('没有可锁定的 K 线时间。');return;}
  const anchor=allCandles.find(bar=>bar.timestamp===time)||allCandles.at(-1);
  mutateDrawings(()=>placeOverlay({id:'cursor-time-lock',name:'verticalStraightLine',lock:true,points:[{timestamp:time,value:anchor?.close??latestPrice()??1}],styles:{line:{color:'#8aa0c8',size:1,style:'dashed'}}}));
  toast('已按时间锁定垂直光标线。');
}
const CHART_TEMPLATE_KEY='shanhai-chart-templates';
function chartTemplates(){try{const value=JSON.parse(localStorage.getItem(CHART_TEMPLATE_KEY)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item==='object'):[];}catch{return [];}}
function saveChartTemplate(){
  const template={savedAt:Date.now(),interval:state.interval,chartType:state.chartType,indicators:[...state.indicators],indicatorParams:plainClone(state.indicatorParams)||{},scale:chartPreferences.scale};
  localStorage.setItem(CHART_TEMPLATE_KEY,JSON.stringify([template,...chartTemplates()].slice(0,12)));
  toast('已把当前周期、图表类型、指标和价格刻度存为本机模板。');
}
async function applyLatestChartTemplate(){
  const template=chartTemplates()[0];
  if(!template){toast('还没有可应用的本机模板。');return;}
  if(['normal','log','percentage'].includes(template.scale))applyChartPreferences({scale:template.scale});
  if(['candle_solid','area','ohlc','candle_hollow'].includes(template.chartType)){state.chartType=template.chartType;if($('#chart-type'))$('#chart-type').value=state.chartType;if(chart)styleChart(chart);if(secondaryChart)styleChart(secondaryChart);}
  if(Array.isArray(template.indicators))state.indicators=template.indicators.filter(name=>supportedIndicators.includes(name));
  if(template.indicatorParams&&typeof template.indicatorParams==='object'){for(const [name,params] of Object.entries(template.indicatorParams))if(Array.isArray(params))state.indicatorParams[name]=params.map(Number);}
  syncIndicators();
  for(const name of state.indicators)if(subPanes.has(name)&&state.indicatorParams[name])chart?.overrideIndicator({name,calcParams:state.indicatorParams[name]},subPanes.get(name));
  toast('已应用最近一个图表模板。');
  if(template.interval&&template.interval!==state.interval&&['1m','5m','15m','30m','1h','4h','1d','1w'].includes(template.interval))await selectInterval(template.interval);
  else scheduleSave();
}
function openCandleTable(){
  closeChartMenu();
  const range=chart?.getVisibleRange?.(),list=chart?.getDataList?.()||[];
  const from=Math.max(0,Number.isFinite(range?.from)?range.from:0),to=Math.min(list.length,Number.isFinite(range?.to)?range.to:list.length);
  const rows=list.slice(from,Math.max(from,to)).filter(bar=>bar&&Number.isFinite(bar.timestamp));
  openModal('表格视图',`<p class="search-hint">当前可见 ${rows.length} 根 K 线 · ${esc(state.symbol)} · ${esc(state.interval.toUpperCase())}</p><div class="candle-table-wrap"><table class="trade-table candle-table"><thead><tr><th>时间</th><th>开</th><th>高</th><th>低</th><th>收</th><th>量</th></tr></thead><tbody>${rows.map(bar=>`<tr><td>${esc(date(bar.timestamp))}</td><td>${fmt(bar.open)}</td><td>${fmt(bar.high)}</td><td>${fmt(bar.low)}</td><td>${fmt(bar.close)}</td><td>${fmt(bar.volume,0)}</td></tr>`).join('')||'<tr><td colspan="6">当前没有可见 K 线。</td></tr>'}</tbody></table></div>`);
}
function menuItems(kind,pointerY,pointerX){
  const selected=chart?.getOverlayById(selectedDrawing),readonly=connection?.role==='reader';
  const sep=()=>({sep:true});
  const item=(id,glyph,label,action,extra={})=>({id,glyph,label,action,...extra});
  const chartTypes=[['candle_solid','蜡烛图','candle'],['candle_hollow','空心蜡烛','candle'],['ohlc','美国线','linear'],['area','折线面积','trend']];
  if(kind==='type')return chartTypes.map(([value,label,glyph])=>item(value,glyph,label,()=>setChartType(value),{selected:state.chartType===value}));
  if(kind==='plus'){
    const price=priceAtClientY(pointerY);
    if(!Number.isFinite(price))return [];
    return [
      item('plus-alert','alert','在此价格添加警报',()=>addPriceAlert(price),{disabled:readonly}),
      item('plus-line','horizontal','在此价格添加水平线',()=>placeHorizontalLine(price),{disabled:readonly}),
    ];
  }
  if(kind==='price')return [
    item('scale-normal','linear','线性刻度',()=>applyChartPreferences({scale:'normal'}),{selected:chartPreferences.scale==='normal'}),
    item('scale-log','log','对数刻度',()=>applyChartPreferences({scale:'log'}),{selected:chartPreferences.scale==='log'}),
    item('scale-percentage','percent','百分比刻度',()=>applyChartPreferences({scale:'percentage'}),{selected:chartPreferences.scale==='percentage'}),
    item('reverse','refresh',chartPreferences.reverse?'恢复价格方向':'反转价格轴',()=>applyChartPreferences({reverse:!chartPreferences.reverse})),
    sep(),
    item('reset-scale','fit','重置价格范围',()=>resetPriceScale(chart)),
  ];
  if(kind==='time')return [
    item('latest','play','滚动到最新',()=>chart.scrollToRealTime()),
    item('fit','fit','显示全部数据',fitChart),
    item('reset','refresh','重置图表视图',resetChartView),
  ];
  if(kind==='drawing'&&selected)return [
    item('delete','trash','删除',removeSelectedDrawing,{kbd:'Delete',disabled:readonly}),
    item('copy','copy','复制',copySelectedDrawing,{disabled:readonly}),
    item('lock',selected.lock?'unlock':'lock',selected.lock?'解锁':'锁定',()=>mutateDrawings(()=>chart.overrideOverlay({id:selected.id,lock:!selected.lock})),{disabled:readonly}),
    item('hide-one','eyeOff','隐藏此图形',hideSelectedDrawing,{disabled:readonly}),
    ...(['localNote','simpleAnnotation','simpleTag'].includes(selected.name)?[item('edit','edit','编辑文字',editDrawingText,{disabled:readonly})]:[]),
    sep(),
    item('objects','objects','图形对象管理',openDrawingManager),
    item('clear','trash','删除当前图表全部画线',removeAllDrawings,{disabled:readonly}),
  ];
  const anchor=rememberPointer(pointerX,pointerY),price=anchor.price,priceText=fmt(price);
  const drawings=userDrawingCount(),indicators=state.indicators.length,locked=Boolean(chart?.getOverlayById?.('cursor-time-lock'));
  return [
    item('reset','refresh','重置图表视图',resetChartView,{kbd:'Alt+R'}),
    item('copy-price','copy',`复制价格 ${priceText}`,()=>copyMenuPrice(price),{disabled:!Number.isFinite(price)}),
    item('paste','copy',chartClipboard?'粘贴':'没有可粘贴的内容',pasteChartClipboard,{disabled:!chartClipboard||readonly}),
    sep(),
    item('alert','alert',`以 ${priceText} 在 ${state.symbol} 上添加警报`,()=>addPriceAlert(price),{kbd:'Alt+A',disabled:readonly||!Number.isFinite(price)}),
    item('lock-cursor','vertical','按时间锁定垂直光标线',()=>toggleCursorLock(anchor.timestamp),{kbd:'Shift+T',disabled:readonly||(!locked&&!Number.isFinite(anchor.timestamp)),selected:locked}),
    sep(),
    item('table','panel','表格视图',openCandleTable),
    item('objects','objects','对象树',openDrawingManager),
    item('templates','save','图表模板',null,{submenu:[
      item('template-save','save','保存当前为模板',saveChartTemplate),
      item('template-apply','refresh','应用最近一个模板',()=>applyLatestChartTemplate(),{disabled:!chartTemplates().length}),
    ]}),
    sep(),
    item('remove-drawings','trash',`移除 ${drawings} 个绘图`,removeAllDrawings,{disabled:readonly||drawings===0}),
    item('remove-indicators','indicators',`移除 ${indicators} 个指标`,removeAllIndicators,{disabled:readonly||indicators===0}),
    sep(),
    item('settings','settings','设置…',openChartSettings),
  ];
}
function menuEntry(item){
  if(item.sep)return '<div class="menu-sep" role="separator"></div>';
  const button=`<button type="button" role="menuitem" data-chart-action="${esc(item.id)}" class="${item.selected?'selected':''}" ${item.disabled?'disabled':''}${item.submenu?' aria-haspopup="menu"':''}>${icon(item.glyph)}<span>${esc(item.label)}</span>${item.submenu?'<kbd aria-hidden="true">›</kbd>':item.kbd?`<kbd>${esc(item.kbd)}</kbd>`:''}</button>`;
  return item.submenu?`<div class="menu-branch">${button}<div class="menu-submenu" role="menu">${item.submenu.map(menuEntry).join('')}</div></div>`:button;
}
function openChartMenu(x,y,kind='chart',pointerY=y,pointerX=x){
  closeChartMenu();closeDrawingMenu();
  const items=menuItems(kind,pointerY,pointerX).filter(Boolean);
  if(!items.length)return;
  const flat=items.flatMap(item=>item.submenu?[item,...item.submenu]:[item]);
  chartContextMenu=document.createElement('div');chartContextMenu.className='chart-context-menu';chartContextMenu.setAttribute('role','menu');chartContextMenu.dataset.kind=kind;
  chartContextMenu.innerHTML=items.map(menuEntry).join('');
  document.body.append(chartContextMenu);
  chartContextMenu.style.left=`${Math.max(4,Math.min(x,innerWidth-chartContextMenu.offsetWidth-8))}px`;chartContextMenu.style.top=`${Math.max(4,Math.min(y,innerHeight-chartContextMenu.offsetHeight-8))}px`;
  const placeSubmenu=branch=>{
    const sub=branch.querySelector('.menu-submenu');if(!sub)return;
    branch.classList.add('open');
    const rect=branch.getBoundingClientRect(),width=sub.offsetWidth||200,height=sub.offsetHeight||80;
    sub.style.left=`${rect.right+6+width>innerWidth-8?Math.max(4,rect.left-width-6):rect.right+6}px`;
    sub.style.top=`${Math.max(4,Math.min(rect.top,innerHeight-height-8))}px`;
  };
  chartContextMenu.querySelectorAll('.menu-branch').forEach(branch=>{
    branch.addEventListener('pointerenter',()=>placeSubmenu(branch));
    branch.addEventListener('pointerleave',()=>branch.classList.remove('open'));
  });
  chartContextMenu.querySelectorAll('[data-chart-action]').forEach(button=>button.onclick=event=>{
    const actionItem=flat.find(item=>item.id===button.dataset.chartAction);
    if(actionItem?.submenu){event.preventDefault();event.stopPropagation();const branch=button.closest('.menu-branch');if(branch.classList.contains('open'))branch.classList.remove('open');else placeSubmenu(branch);return;}
    closeChartMenu();actionItem?.action?.();
  });
  chartContextMenu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeChartMenu();return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    event.preventDefault();
    const buttons=[...chartContextMenu.querySelectorAll('button:not(:disabled)')].filter(button=>button.getClientRects().length),i=buttons.indexOf(document.activeElement);
    buttons[(i+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
  });
  chartContextMenu.querySelector('button:not(:disabled)')?.focus();
}
function openWatchMenu(x,y,symbol){
  closeChartMenu();
  const quote=quotes.get(symbol);
  const items=[
    {id:'open',glyph:'trend',label:'打开图表',action:()=>selectSymbol(symbol)},
    {id:'copy',glyph:'copy',label:'复制代码',action:()=>copyText(symbol)},
    {id:'alert',glyph:'alert',label:'按最近价添加提醒',action:()=>{selectSymbol(symbol).then(()=>placePriceAlert(quote?.price));},disabled:!Number.isFinite(quote?.price)},
    {id:'remove',glyph:'trash',label:'从自选移除',action:()=>{state.watchlist=state.watchlist.filter(item=>item!==symbol);renderWatchlist();scheduleSave();}},
  ];
  chartContextMenu=document.createElement('div');chartContextMenu.className='chart-context-menu';chartContextMenu.setAttribute('role','menu');
  chartContextMenu.innerHTML=items.map(item=>`<button type="button" role="menuitem" data-chart-action="${item.id}" ${item.disabled?'disabled':''}>${icon(item.glyph)}<span>${esc(item.label)}</span></button>`).join('');
  document.body.append(chartContextMenu);
  chartContextMenu.style.left=`${Math.max(4,Math.min(x,innerWidth-chartContextMenu.offsetWidth-8))}px`;chartContextMenu.style.top=`${Math.max(4,Math.min(y,innerHeight-chartContextMenu.offsetHeight-8))}px`;
  chartContextMenu.querySelectorAll('[data-chart-action]').forEach(button=>button.onclick=()=>{const action=items.find(item=>item.id===button.dataset.chartAction)?.action;closeChartMenu();action?.();});
}
function setChartType(value){
  state.chartType=value;if($('#chart-type'))$('#chart-type').value=value;styleChart(chart);if(secondaryChart)styleChart(secondaryChart);scheduleSave();
}
function hideSelectedDrawing(){
  if(!selectedDrawing)return;const id=selectedDrawing;
  mutateDrawings(()=>{drawingVisibility.set(id,false);chart.overrideOverlay({id,visible:false});hideSelection(id);});
}
function copyText(text){
  const value=String(text??'');if(!value||value==='—'){toast('没有可复制的内容。');return;}
  navigator.clipboard?.writeText(value).then(()=>toast(`已复制 ${value}`)).catch(()=>toast('复制没有成功。'));
}
const intervals=['1m','5m','15m','30m','1h','4h','1d','1w'];
function stepInterval(direction){const index=Math.max(0,intervals.indexOf(state.interval));selectInterval(intervals[(index+direction+intervals.length)%intervals.length]);}
function zoomChart(direction){if(!chart)return;chart.setBarSpace(Math.max(1,Math.min(40,chart.getBarSpace()*(direction>0?1.15:0.87))));}
function placePriceAlert(explicit){
  if(!canEditDrawings())return;
  const price=Number.isFinite(Number(explicit))?Number(explicit):Number(payload?.quote?.price??allCandles.at(-1)?.close);
  if(!Number.isFinite(price)||price<=0||!allCandles.length){toast('当前没有可标注的价格。');return;}
  const id=crypto.randomUUID();
  state.alerts.push({id,symbol:state.symbol,price,direction:'above',createdAt:Date.now(),firedAt:null});
  placeOverlay({name:'horizontalStraightLine',points:[{timestamp:allCandles.at(-1).timestamp,value:price}],styles:{line:{color:'#d4a94e',size:1}}});
  placeOverlay({name:'localNote',points:[{timestamp:allCandles.at(-1).timestamp,value:price}],extendData:`提醒 ${fmt(price)}`});
  commitDrawings();
  const saved=saveState(false);
  $('#alert-count').textContent=state.alerts.filter(alert=>!alert.firedAt).length;
  if(activeTab==='alerts')renderAlerts();
  toast(`已在 ${fmt(price)} 添加价格提醒。`);
  return saved;
}
function updateSelectedStyle(){
  const overlay=chart?.getOverlayById(selectedDrawing);if(!overlay)return;
  const color=$('#drawing-color').value,size=Number($('#drawing-width').value)||1;
  const style=$('#drawing-line-style').value;
  mutateDrawings(()=>chart.overrideOverlay({id:selectedDrawing,styles:{line:{color,size,style},rect:{borderColor:color,borderSize:size},text:{color},circle:{borderColor:color,borderSize:size}}}));
}
function openModal(title,body){
  $('#modal-content').innerHTML=`<div class="modal-header"><h2>${esc(title)}</h2><button id="close-modal" class="icon-button" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if(!$('#modal').open)$('#modal').showModal();$('#close-modal').onclick=()=>$('#modal').close();
}
function openSearch(){
  const filters=[['all','全部'],['crypto','加密'],['cn','A股'],['hk','港股'],['us','美股'],['etf','ETF'],['forex','外汇'],['futures','国际期货'],['indices','指数'],['global','其他市场'],['local','本地']];
  openModal('查找市场与标的',`<input class="search-input" id="symbol-search" placeholder="代码、中文或英文名称，如 PANW、600900、腾讯" aria-label="搜索代码或名称" autocomplete="off"/><div class="search-markets" role="group" aria-label="按市场筛选">${filters.map(([market,label])=>`<button data-search-market="${market}" class="${market==='all'?'selected':''}" aria-pressed="${market==='all'}">${label}</button>`).join('')}</div><div class="search-summary"><span id="search-count"></span><span id="search-status" role="status"></span></div><div id="search-results" class="search-results"></div><p class="search-hint" id="search-hint">内置 ${catalog.length} 个品种，可按市场浏览。完整代码支持目录外查询，如 NASDAQ:PLTR、600900、0700.HK、OKX:SUI-USDT。</p>`);
  const input=$('#symbol-search');
  let timer,request=0,controller,searchMarket='all',items=catalog;
  const show=items=>{
    const visible=items.filter(item=>searchMarket==='all'||(searchMarket==='etf'?item.type==='etf':item.market===searchMarket));
    $('#search-count').textContent=`${visible.length} 个${searchMarket==='all'?'品种':filters.find(([key])=>key===searchMarket)[1]+'品种'}`;
    $('#search-results').innerHTML=visible.map(item=>`<div class="search-result" data-result="${esc(item.symbol)}" role="button" tabindex="0"><div>${symbolMark(item.symbol)}<div class="search-name"><strong>${esc(item.symbol)}</strong><small>${esc(item.name)}${item.direct?' · 代码直达，待行情源验证':''}</small></div></div><span class="market-tag">${esc(marketNames[item.market]||'其他市场')}${item.exchange?` · ${esc(item.exchange)}`:''}</span><button class="add-button" data-add="${esc(item.symbol)}" title="加入自选">${state.watchlist.includes(item.symbol)?'已添加':'+ 自选'}</button></div>`).join('')||'<p class="search-hint search-empty">当前分类没有匹配结果。试试切换「全部」、完整交易代码或英文名称。</p>';
    activateSymbolMarks($('#search-results'));
    $$('[data-result]').forEach(row=>{const select=()=>{selectSymbol(row.dataset.result);$('#modal').close();};row.onclick=event=>{if(!event.target.closest('[data-add]'))select();};row.onkeydown=event=>{if(event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();select();}};});
    $$('[data-add]').forEach(button=>button.onclick=event=>{event.stopPropagation();if(!state.watchlist.includes(button.dataset.add)){if(state.watchlist.length>=150){toast('自选最多保存 150 个品种，请先移除部分自选。');return;}state.watchlist.push(button.dataset.add);button.textContent='已添加';renderWatchlist();refreshWatchlist();scheduleSave();}});
  };
  $$('[data-search-market]').forEach(button=>button.onclick=()=>{
    searchMarket=button.dataset.searchMarket;
    $$('[data-search-market]').forEach(item=>{item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));});
    show(items);$('#search-results').scrollTop=0;
  });
  show(items);input.focus();
  input.oninput=event=>{
    const query=event.target.value.trim(),id=++request;clearTimeout(timer);controller?.abort();
    items=catalog.filter(item=>`${item.symbol} ${item.name} ${item.exchange}`.toLowerCase().includes(query.toLowerCase()));
    show(items);$('#search-results').scrollTop=0;
    $('#search-status').textContent=query?'正在查询更多品种…':'';
    $('#search-hint').textContent=query?'正在搜索本地与在线目录；可随时切换市场分类。':`内置 ${catalog.length} 个品种，可按市场浏览；也可输入完整代码查询更多品种。`;
    if(!query)return;
    timer=setTimeout(async()=>{
      controller=new AbortController();
      try{
        const result=await api(`/api/search?q=${encodeURIComponent(query)}`,{signal:controller.signal});
        if(id!==request||$('#symbol-search')!==input)return;
        for(const item of result.results){const index=catalog.findIndex(old=>old.symbol===item.symbol);if(index<0)catalog.push(item);else if(catalog[index].direct&&!item.direct)catalog[index]=item;}
        items=result.results;show(items);
        $('#search-hint').textContent=result.meta?.warnings?.join(' ')||'点击品种打开图表，或点击「+ 自选」加入列表。';
      }catch(error){if(error.name!=='AbortError'&&id===request&&$('#symbol-search')===input)$('#search-hint').textContent=error.message;}
      finally{if(id===request&&$('#symbol-search')===input)$('#search-status').textContent='';}
    },300);
  };
  $('#modal').addEventListener('close',()=>{clearTimeout(timer);controller?.abort();request++;},{once:true});
}
function openIndicators(){
  openModal('技术指标',`<p class="drawing-help">主图可叠加多条均线；独立窗格可拖动边界调高。点击已添加的指标可移除。</p><div class="indicator-grid">${supportedIndicators.map(name=>`<button class="indicator-option ${state.indicators.includes(name)?'active':''}" data-indicator="${esc(name)}"><div><strong>${esc(name)}</strong><small>${esc(indicatorDescriptions[name]||name)}</small></div><span>${state.indicators.includes(name)?'✓':'+'}</span></button>`).join('')}</div><p class="search-hint">在图表上方点击指标名称可调整参数；Pine 编辑器可添加自己的指标。</p>`);
  $$('[data-indicator]').forEach(button=>button.onclick=()=>{toggleIndicator(button.dataset.indicator);button.classList.toggle('active',state.indicators.includes(button.dataset.indicator));button.querySelector('span').textContent=state.indicators.includes(button.dataset.indicator)?'✓':'+';});
}
function indicatorParameters(name){
  const indicator=chart.getIndicatorByPaneId(subPanes.get(name),name);const params=state.indicatorParams[name]||indicator?.calcParams||[];
  if(!params.length){toast('这个指标没有可调整参数。');return;}
  openModal(`${name} · 参数`, `<form id="indicator-form"><div class="field-grid">${params.map((value,index)=>`<label>参数 ${index+1}<input type="number" name="param${index}" value="${esc(value)}" min="0.01" max="10000" step="any" required></label>`).join('')}</div><p class="search-hint">${esc(indicatorDescriptions[name]||name)} · 输入正数周期或倍数。</p><button class="primary" style="margin-top:18px">应用参数</button></form>`);
  $('#indicator-form').onsubmit=event=>{event.preventDefault();const values=[...event.target.querySelectorAll('input')].map(input=>Number(input.value));state.indicatorParams[name]=values;chart.overrideIndicator({name,calcParams:values},subPanes.get(name));syncIndicators();scheduleSave();$('#modal').close();};
}

function renderPanel(){
  if(activeTab==='backtest')renderBacktest();else if(activeTab==='pine')renderPine();else if(activeTab==='data')renderData();else if(activeTab==='collab')renderCollaboration();else if(activeTab==='accounts')mountAccountSettings({container:$('#panel-content'),api,esc,toast,connection,isActive:()=>activeTab==='accounts',updated:async()=>{catalog=(await api('/api/catalog')).results;renderWatchlist();}});else renderAlerts();
}
function setTab(tab){
  setModule('research',true);
  activeTab=tab;$$('[data-tab]').forEach(button=>{button.classList.toggle('selected',button.dataset.tab===tab);button.setAttribute('aria-selected',String(button.dataset.tab===tab));});renderPanel();
}
function readBacktestForm(){
  const form=$('#backtest-form');if(!form)return;const values=Object.fromEntries(new FormData(form));
  state.backtestOptions={...state.backtestOptions,...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,key==='strategy'?value:Number(value)]))};
}
function renderBacktest(){
  const o=state.backtestOptions;
  $('#panel-content').innerHTML=`<form id="backtest-form" class="backtest-controls"><label class="compact-field">策略<select name="strategy" aria-label="回测策略"><option value="ema-cross" ${o.strategy==='ema-cross'?'selected':''}>EMA 双均线</option><option value="rsi" ${o.strategy==='rsi'?'selected':''}>RSI 超买超卖</option><option value="buy-hold" ${o.strategy==='buy-hold'?'selected':''}>买入持有</option></select></label><label class="compact-field">快线<input name="fast" aria-label="快线周期" type="number" min="2" max="300" value="${o.fast}" required></label><label class="compact-field">慢线<input name="slow" aria-label="慢线周期" type="number" min="3" max="500" value="${o.slow}" required></label><label class="compact-field">本金<input name="initialCapital" aria-label="初始本金" type="number" min="1" max="1000000000" step="any" value="${o.initialCapital}" required></label><label class="compact-field">费率 bp<input name="feeBps" aria-label="手续费基点" type="number" min="0" max="1000" step="any" value="${o.feeBps}" required></label><label class="compact-field">滑点 bp<input name="slippageBps" aria-label="滑点基点" type="number" min="0" max="1000" step="any" value="${o.slippageBps}" required></label><button class="primary" ${allCandles.length?'':'disabled'}>运行回测</button></form><div id="backtest-results"></div>`;
  $('#backtest-form').onsubmit=event=>{event.preventDefault();readBacktestForm();calculateBacktest();};$('#backtest-form').onchange=()=>{readBacktestForm();scheduleSave();};
  if(backtestResult)renderBacktestResults();else $('#backtest-results').innerHTML=`<div class="empty-panel">${icon('backtest')}<div><strong>${allCandles.length?'在当前历史区间验证一个想法':'载入行情后开始研究'}</strong><p>已收盘信号 → 下一根开盘成交。双边手续费、滑点与持仓回撤均计入。</p><p>${allCandles.length?`本次可用 ${closedCandles().length} 根历史 K线。`:'支持在线行情和自有 CSV。'} 全仓长仓 / 空仓，不含杠杆或合约保证金。</p></div></div>`;
}
function calculateBacktest(){
  try{backtestResult=runBacktest(closedCandles(),state.backtestOptions);if(!state.imports[state.symbol])backtestResult.warnings.unshift('仅使用确认收盘的 K 线；没有明确收盘标志时保守排除最新一根。');if(['futures','cn-futures'].includes(currentInstrument().market))backtestResult.warnings.unshift('期货按价格序列作无杠杆研究，不含合约乘数、保证金、换月与交割。');drawSignals(backtestResult.markers,'backtest-signals');renderBacktestResults();scheduleSave();}
  catch(error){backtestResult=null;$('#backtest-results').innerHTML=`<p class="inline-error">${esc(error.message)}</p>`;}
}
function renderBacktestResults(){
  const {metrics:m,equity,warnings}=backtestResult;const values=equity.map(point=>point.equity),min=Math.min(...values),max=Math.max(...values),span=max-min||1;
  const line=values.map((value,index)=>`${index/(values.length-1||1)*800},${47-(value-min)/span*42}`).join(' ');
  const metrics=[['累计收益',pct(m.totalReturn),sign(m.totalReturn),`基准 ${pct(m.benchmarkReturn)}`],['最大回撤',`${(m.maxDrawdown*100).toFixed(2)}%`,'negative','含持仓浮动权益'],['交易胜率',`${(m.winRate*100).toFixed(1)}%`,'',`${m.tradeCount} 笔已平仓交易`],['盈亏比因子',m.profitFactor===null?'—':fmt(m.profitFactor,2),'','盈利总额 / 亏损总额'],['期末权益',fmt(m.finalEquity,0),sign(m.netProfit),`${payload?.meta.currency||'计价单位'} · 费用 ${fmt(m.totalFees,2)}`]];
  $('#backtest-results').innerHTML=`<div class="metric-grid">${metrics.map(([label,value,cls,hint])=>`<div class="metric"><span>${label}</span><strong class="${cls}">${value}</strong><small>${hint}</small></div>`).join('')}</div><div class="backtest-bottom"><div class="equity-wrap"><div class="equity-label"><span>账户权益 · ${esc(payload?.meta.currency||'计价单位')}</span><span>${shortDate(equity[0].timestamp)} — ${shortDate(equity.at(-1).timestamp)}</span></div><div class="equity-chart"><svg viewBox="0 0 800 52" preserveAspectRatio="none" role="img" aria-label="账户权益随交易时间变化"><title>账户权益，横轴为交易时间，纵轴为 ${esc(payload?.meta.currency||'计价单位')}；最低 ${fmt(min)}，最高 ${fmt(max)}</title><line x1="0" y1="49" x2="800" y2="49" stroke="var(--line)"/><polyline points="${line}" stroke="var(--accent)" fill="none"/></svg></div></div><div class="backtest-note">收盘信号 / 下一根开盘成交<br>全仓长仓，数据末尾按收盘清算<br><button id="view-trades">查看交易与撮合说明 →</button></div></div>`;
  $('#view-trades').onclick=()=>{
    openModal('回测交易记录',`<p class="metric-hint">${closedCandles().length} 根 K线 · ${esc(state.symbol)} · ${esc(state.interval)}。买卖两侧都计入费率与滑点；基准为区间首末收盘价涨幅，不扣成本。</p><div class="modal-section"><table class="trade-table"><thead><tr><th>买入 / 卖出</th><th>成交价</th><th>净盈亏</th><th>原因</th></tr></thead><tbody>${backtestResult.trades.map(trade=>`<tr><td>${esc(date(trade.entryTimestamp))}<br>${esc(date(trade.exitTimestamp))}</td><td>${fmt(trade.entryPrice)}<br>${fmt(trade.exitPrice)}</td><td class="${sign(trade.pnl)}">${fmt(trade.pnl)}<br>${pct(trade.returnPct)}</td><td>${trade.forcedExit?'期末清算':esc(trade.exitReason)}</td></tr>`).join('')}</tbody></table>${backtestResult.trades.length?'':'<p class="search-hint">这个区间没有触发完整往返交易。</p>'}</div><div class="modal-section"><h3>计算边界</h3><ul>${warnings.map(warning=>`<li>${esc(warning)}</li>`).join('')}<li>RSI 策略使用 14 周期、30 / 70 阈值。不处理做空、税费、股票整手、期货合约乘数、保证金或换汇。</li><li>收益与回撤仅描述已载入样本。</li></ul></div><button class="secondary" id="download-backtest">导出回测 JSON</button>`);
    $('#download-backtest').onclick=()=>downloadJson(`${state.symbol}-backtest.json`,{symbol:state.symbol,interval:state.interval,...backtestResult});
  };
}
registerOverlay({name:'localSignal',totalStep:1,needDefaultPointFigure:false,needDefaultXAxisFigure:false,needDefaultYAxisFigure:false,createPointFigures:({coordinates,overlay})=>{
  if(!coordinates.length)return[];const point=coordinates[0],info=overlay.extendData;
  return[{type:'text',attrs:{x:point.x,y:point.y+(info.below?14:-14),text:info.text,align:'center',baseline:'middle'},styles:{color:info.color,size:9,family:'Menlo, monospace',backgroundColor:'transparent',borderRadius:2,paddingLeft:2,paddingRight:2}}];
}});
function drawSignals(markers,groupId){
  chart.removeOverlay({groupId});const byTime=new Map(visibleCandles().map(bar=>[bar.timestamp,bar]));
  for(const marker of markers.slice(-300)){const timestamp=marker.timestamp??marker.time,bar=byTime.get(timestamp);if(!bar)continue;const below=marker.position==='belowBar';chart.createOverlay({name:'localSignal',groupId,lock:true,points:[{timestamp,value:below?bar.low:bar.high}],extendData:{below,color:marker.color||(below?'#3d9b78':'#c45c6a'),text:marker.text||(below?'B':'S')}});}
}
function renderPine(){
  $('#panel-content').innerHTML=`<div class="pine-layout"><div class="pine-editor-wrap"><div class="pine-actions"><select id="pine-example" aria-label="Pine 示例"><option value="">选择示例</option><option value="ema">双均线 EMA</option><option value="rsi">RSI 动量</option><option value="macd">MACD</option><option value="strategy">策略示例 · 实验</option></select><button class="quiet" id="pine-save">保存脚本</button><select id="pine-saved" aria-label="已保存脚本"><option value="">我的脚本</option>${Object.keys(state.scripts).map(name=>`<option>${esc(name)}</option>`).join('')}</select><button class="quiet" id="pine-clear">移除绘图</button><button class="primary" id="pine-run" ${allCandles.length?'':'disabled'}>运行到图表</button></div><textarea class="pine-editor" id="pine-code" aria-label="Pine Script 源代码" spellcheck="false"></textarea></div><div class="pine-output" id="pine-output"></div></div>`;
  $('#pine-code').value=state.pineCode;$('#pine-code').oninput=event=>{state.pineCode=event.target.value;scheduleSave();};
  $('#pine-code').onkeydown=event=>{if(event.key==='Tab'){event.preventDefault();const target=event.target;target.setRangeText('    ',target.selectionStart,target.selectionEnd,'end');state.pineCode=target.value;scheduleSave();}if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();runPine();}};
  $('#pine-example').onchange=event=>{if(examples[event.target.value]){state.pineCode=examples[event.target.value];$('#pine-code').value=state.pineCode;scheduleSave();}};
  $('#pine-saved').onchange=event=>{if(state.scripts[event.target.value]){state.pineCode=state.scripts[event.target.value];$('#pine-code').value=state.pineCode;scheduleSave();}};
  $('#pine-save').onclick=()=>{const name=prompt('脚本名称',pineResult?.indicator?.title||'我的指标');if(!name?.trim())return;state.scripts[name.trim().slice(0,100)]=state.pineCode;saveState(false);renderPine();toast('脚本已保存到本地工作区。');};
  $('#pine-clear').onclick=()=>{chart.removeIndicator('candle_pane','LOCAL_PINE_OVERLAY');chart.removeIndicator('pine_pane','LOCAL_PINE_PANE');chart.removeOverlay({groupId:'pine-signals'});pineResult=null;renderPineOutput();};
  $('#pine-run').onclick=runPine;renderPineOutput();
}
function stopPine(){if(pineWorker){pineWorker.terminate();pineWorker=null;}}
async function runPine(){
  if(!allCandles.length)return;stopPine();state.pineCode=$('#pine-code')?.value||state.pineCode;
  const data=structuredClone(visibleCandles()),symbol=state.symbol,interval=state.interval,code=state.pineCode,button=$('#pine-run');button.disabled=true;button.textContent='载入脚本数据…';
  $('#pine-output').innerHTML='<h3>本地执行中</h3><p>正在读取脚本请求的独立行情，再交给工作线程计算。</p>';
  let datasets;
  try{const requests=collectPineRequests(code,symbol,interval).filter(r=>r.symbol!==canonicalSymbol(symbol)||r.interval!==interval);datasets=await Promise.all(requests.map(async r=>{const value=await api(`/api/candles?${new URLSearchParams({symbol:r.symbol,interval:r.interval,limit:1000})}`);return {symbol:r.symbol,interval:r.interval,candles:value.candles,meta:value.meta};}));}
  catch(error){pineResult={ok:false,error:{code:error.code,message:error.message},warnings:[]};if($('#pine-run')){$('#pine-run').disabled=false;$('#pine-run').textContent='运行到图表';renderPineOutput();}return;}
  if(symbol!==state.symbol||interval!==state.interval)return;button.textContent='编译与计算…';
  const worker=new Worker(new URL('./pine-worker.js',import.meta.url),{type:'module'});pineWorker=worker;
  const result=await new Promise(resolve=>{
    const timer=setTimeout(()=>{worker.terminate();resolve({ok:false,error:{message:'执行超过 15 秒，已停止工作线程。',hint:'缩短历史区间或简化脚本。'},warnings:[]});},15000);
    worker.onmessage=event=>{clearTimeout(timer);resolve(event.data);};worker.onerror=event=>{clearTimeout(timer);resolve({ok:false,error:{message:event.message||'Pine 工作线程加载失败。'},warnings:[]});};worker.postMessage({code,candles:data,symbol,interval,datasets});
  });
  worker.terminate();if(pineWorker===worker)pineWorker=null;if(symbol!==state.symbol||interval!==state.interval)return;pineResult=result;
  if(result.ok){try{applyPinePlots(result);toast(`已运行 ${result.indicator.title} · ${result.plots.length} 个绘图输出`);}catch(error){pineResult={...result,ok:false,error:{message:`图表显示失败：${error.message}`}};}}
  if($('#pine-run')){$('#pine-run').disabled=false;$('#pine-run').textContent='运行到图表';renderPineOutput();}scheduleSave();
}
function renderPineOutput(){
  if(!$('#pine-output'))return;
  if(!pineResult){$('#pine-output').innerHTML='<h3>Pine v5 / v6 · 实验兼容</h3><p>使用真实 PineTS 运行时，在本机计算并绘图。⌘ Enter 运行。</p><p>支持常用 ta.*、plot、plotshape。跨标的 / 跨周期数据与复杂绘图仍有缺口。</p><p>脚本与数据不会发送到 TradingView。</p>';return;}
  const result=pineResult,error=result.error;
  $('#pine-output').innerHTML=`<h3 class="${result.ok?'positive':'negative'}">${result.ok?'执行完成':'执行失败'}</h3>${result.ok?`<p>${esc(result.indicator.title)}<br>${result.plots.length} 个序列 · ${result.markers.length} 个标记</p>`:`<pre>${esc(typeof error==='string'?error:error?.message)}${error?.details?'\n'+esc(error.details):''}</pre><p>${esc(error?.hint||'')}</p>`}${result.strategy?`<p>Pine 策略统计（实验）<br>已平仓 ${result.strategy.closedTradeCount} 笔<br>净利润 ${fmt(result.strategy.netProfit)}</p>`:''}${(result.warnings||[]).map(warning=>`<p>${esc(warning)}</p>`).join('')}`;
}
function applyPinePlots(result){
  chart.removeIndicator('candle_pane','LOCAL_PINE_OVERLAY');chart.removeIndicator('pine_pane','LOCAL_PINE_PANE');
  for(const [overlay,name,pane] of [[true,'LOCAL_PINE_OVERLAY','candle_pane'],[false,'LOCAL_PINE_PANE','pine_pane']]){
    const plots=result.plots.filter(plot=>Boolean(plot.overlay)===overlay);if(!plots.length)continue;const maps=plots.map(plot=>new Map(plot.data.map(point=>[point.time,point])));
    registerIndicator({name,shortName:result.indicator.title,precision:overlay?chart.getPriceVolumePrecision().price:2,series:overlay?'price':'normal',figures:plots.map((plot,index)=>({key:`p${index}`,title:`${plot.title}: `,type:plot.type==='histogram'?'bar':'line',baseValue:0,styles:data=>({color:maps[index].get(data?.current?.kLineData?.timestamp)?.color||plot.color,size:plot.width,style:plot.type==='histogram'?'fill':'solid'})})),calc:data=>data.map(bar=>Object.fromEntries(maps.map((map,index)=>[`p${index}`,map.get(bar.timestamp)?.value??undefined])))});
    chart.createIndicator(name,true,{id:pane,...(!overlay?{height:110,minHeight:55}:{})});
  }
  drawSignals(result.markers,'pine-signals');
}

function renderData(){
  const meta=payload?.meta;
  $('#panel-content').innerHTML=`<div class="data-grid"><div><h3>当前数据源</h3>${meta?`<dl class="source-details"><dt>行情来源</dt><dd>${esc(meta.providerName)} · ${esc(delayLabel(meta))}</dd><dt>报价更新</dt><dd>${esc(liveMeta?.providerName||meta.providerName)} · ${esc(delayLabel(liveMeta||meta))}<br>源时间 ${esc(date(payload?.quote.timestamp))}${liveMeta?.feedType==='push'?` · 接收差 ${Math.max(0,liveMeta.receivedAt-liveMeta.sourceTime)} ms`: ' · 网页端延迟未保证'}</dd><dt>数据区间</dt><dd>${esc(date(allCandles[0]?.timestamp))}<br>${esc(date(allCandles.at(-1)?.timestamp))}</dd><dt>更新时间</dt><dd>${esc(date(meta.fetchedAt||meta.cachedAt))}</dd><dt>缓存状态</dt><dd>${esc(meta.cache==='stale'?'断网历史缓存':meta.cache==='fresh'?'本地新鲜缓存':meta.provider==='csv'?'用户导入':'在线读取后存盘')}</dd></dl>`:'<p>载入行情后显示来源、时间范围与数据限制。</p>'}<div class="data-buttons"><button class="secondary" id="csv-import-button">导入 CSV</button><button class="secondary" id="csv-export-button" ${allCandles.length?'':'disabled'}>导出 OHLCV</button><button class="quiet" id="restore-workspace">导入工作区</button></div></div><div><h3>数据与计算口径</h3><ul class="warning-list">${(meta?.warnings||['行情在线请求，下载后可使用缓存离线研究。']).map(warning=>`<li>${esc(warning)}</li>`).join('')}<li>CSV 支持中英 OHLCV 表头与毫秒/秒/ISO 时间；导入时会验证并报告错误。</li><li>加密现货使用官方推送；A股、港股、外汇使用公开报价轮询。美股、国际期货与指数须查看各源的报价时间和延迟。</li></ul>${meta?.sourceUrl?`<a href="${esc(meta.sourceUrl)}" target="_blank" rel="noreferrer" class="search-hint">查看当前数据请求 ↗</a>`:''}</div></div>`;
  $('#csv-import-button').onclick=()=>$('#csv-file').click();$('#csv-export-button').onclick=()=>download(`${state.symbol}-${state.interval}.csv`,exportCandlesCsv(allCandles),'text/csv;charset=utf-8');$('#restore-workspace').onclick=()=>$('#workspace-file').click();
}
const noticeText={feishu:'已发飞书','lark-cli-user':'已通过飞书发给你','lark-cli-bot':'已通过飞书机器人发出','feishu-webhook':'已发飞书 webhook',missing_webhook:'已触发 · 飞书未发送',cli_unavailable:'已触发 · 飞书未登录',invalid_webhook:'已触发 · webhook 无效',local:'已触发'};
function renderAlerts(){
  $('#alert-count').textContent=state.alerts.filter(alert=>!alert.firedAt).length;
  $('#panel-content').innerHTML=`<form id="alert-form" class="alert-form"><strong>${esc(state.symbol)}</strong><select name="direction" aria-label="提醒条件"><option value="above">价格达到或高于</option><option value="below">价格达到或低于</option></select><input name="price" aria-label="目标价格" type="number" step="any" min="0.00000001" value="${allCandles.length?(allCandles.at(-1).close*1.03).toFixed(allCandles.at(-1).close<1?6:2):''}" placeholder="目标价" required><button class="primary">创建提醒</button><span class="search-hint" id="alert-channel" style="margin:0">正在检查飞书通道…</span></form><button type="button" class="quiet" id="alert-test">发送飞书测试</button><div class="alerts-list">${state.alerts.map(alert=>`<div class="alert-row ${alert.firedAt?'fired':''}"><strong>${esc(alert.symbol)}</strong><span>${alert.direction==='above'?'≥':'≤'} <b class="number">${fmt(alert.price)}</b></span><span>${alert.firedAt?`${esc(noticeText[alert.notice]||'已触发')} ${esc(date(alert.firedAt))}`:'等待触发'}</span><button data-delete-alert="${esc(alert.id)}" aria-label="删除提醒">${icon('trash')}</button></div>`).join('')||'<p class="search-hint">在当前图表创建价格条件。行情到达后立即判断。</p>'}</div>`;
  $('#alert-form').onsubmit=async event=>{
    event.preventDefault();const form=new FormData(event.target);const price=Number(form.get('price'));
    if(!Number.isFinite(price)||price<=0){toast('目标价需要是正数。');return;}
    state.alerts.push({id:crypto.randomUUID(),symbol:state.symbol,price,direction:form.get('direction'),createdAt:Date.now(),firedAt:null});
    const saved=await saveState(false);renderAlerts();toast(saved?'提醒已创建。行情一到就判断，不再等整分钟。':'提醒留在页面上，但还没写入主机。');
  };
  $$('[data-delete-alert]').forEach(button=>button.onclick=()=>{state.alerts=state.alerts.filter(alert=>alert.id!==button.dataset.deleteAlert);scheduleSave();renderAlerts();});
  $('#alert-test').onclick=async()=>{try{const result=await api('/api/alerts/test',{method:'POST'});toast(result.sent?'飞书测试消息已发送。':'飞书测试没有发出。');}catch(error){toast(`飞书测试没有发出：${error.message}`);}};
  api('/api/alerts/channel').then(value=>{const el=$('#alert-channel');if(!el)return;el.textContent=value.label||value.missing;}).catch(error=>{const el=$('#alert-channel');if(el)el.textContent=error.message;});
}
function applyAlert(event){
  const incoming=event.alert;if(!incoming?.id)return;
  const alert=state.alerts.find(item=>item.id===incoming.id);if(!alert||alert.firedAt)return;
  alert.firedAt=incoming.firedAt;alert.triggerPrice=incoming.triggerPrice;alert.notice=incoming.notice;
  const channel=['feishu','lark-cli-user','lark-cli-bot','feishu-webhook'].includes(incoming.notice)?`${noticeText[incoming.notice]}。`:'飞书未发出，仅在本机提示。';
  toast(`价格提醒：${alert.symbol} ${fmt(incoming.triggerPrice)}，已${alert.direction==='above'?'达到或高于':'达到或低于'} ${fmt(alert.price)}。${channel}`);
  scheduleSave();if(activeTab==='alerts')renderAlerts();else $('#alert-count').textContent=state.alerts.filter(item=>!item.firedAt).length;
}
function startReplay(){
  if(!allCandles.length){toast('请先载入行情。');return;}if(state.dual)toggleLayout();replay=true;replayCount=Math.max(2,Math.floor(allCandles.length*.55));$('#replay-strip').classList.remove('hidden');$('#replay-button').classList.add('active');$('#replay-slider').min='2';$('#replay-slider').max=String(allCandles.length);$('#replay-slider').value=String(replayCount);$('#replay-play').innerHTML=icon('play');applyReplay();
}
function applyReplay(){removeComputed();const data=visibleCandles();chart.applyNewData(data,false);chart.scrollToRealTime();$('#replay-slider').value=String(replayCount);$('#replay-time').textContent=date(data.at(-1)?.timestamp);renderHeader();renderPanel();}
function stopReplayTimer(){clearInterval(replayTimer);replayTimer=null;$('#replay-play').innerHTML=icon('play');}
function exitReplay(render=true){if(!replay)return;stopReplayTimer();replay=false;$('#replay-strip').classList.add('hidden');$('#replay-button').classList.remove('active');if(render){removeComputed();chart.applyNewData(allCandles,false);chart.scrollToRealTime();renderHeader();renderPanel();}}
function advanceReplay(){if(replayCount>=allCandles.length){stopReplayTimer();return;}replayCount++;applyReplay();}
function download(name,contents,type){const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadJson(name,value){download(name,JSON.stringify(value,null,2),'application/json');}
async function importCsv(file){
  if(!file)return;
  try{
    const result=parseCandlesCsv(await file.text());if(result.candles.length<2)throw new Error('至少需要两根有效 K线。');
    const name=prompt('为这份本地数据命名',file.name.replace(/\.csv$/i,'').replace(/[^\w.\-\u4e00-\u9fa5]/g,'_'));if(!name?.trim())return;
    const symbol=`CSV:${name.trim().slice(0,40)}`;serializeDrawings();const last=result.candles.at(-1),first=result.candles[0];
    state.imports[symbol]={symbol,interval:state.interval,candles:result.candles,meta:{provider:'csv',providerName:'用户本地 CSV',name:name.trim(),exchange:'LOCAL',currency:'计价单位',fetchedAt:Date.now(),delayMinutes:null,warnings:[...result.warnings,'CSV 各行按用户提供的已收盘 K线处理；涨跌幅为导入区间首末价格变化。']},quote:{price:last.close,change:last.close-first.close,changePercent:(last.close/first.close-1)*100,timestamp:last.timestamp,volume:last.volume}};
    catalog.push({symbol,name:name.trim(),market:'local',exchange:'LOCAL'});if(!state.watchlist.includes(symbol))state.watchlist.push(symbol);await selectSymbol(symbol);await saveState(false);toast(`已导入 ${result.candles.length} 根 K线${result.warnings.length?'，请在“行情与数据”查看提示':''}。`);
  }catch(error){toast(error.message);}finally{$('#csv-file').value='';}
}
function validateState(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('工作区格式无效。');if(value.schemaVersion!==1)throw new Error('工作区版本不支持。');
  if(typeof value.symbol!=='string'||!['1m','5m','15m','30m','1h','4h','1d','1w'].includes(value.interval))throw new Error('工作区标的或周期无效。');
  if(!Array.isArray(value.watchlist)||!value.watchlist.every(item=>typeof item==='string')||value.watchlist.length>150)throw new Error('自选列表无效或超过 150 个。');
  if(typeof value.pineCode!=='string'||value.pineCode.length>100000)throw new Error('工作区脚本无效或过长。');
  if(!Array.isArray(value.indicators)||!value.indicators.every(name=>supportedIndicators.includes(name)))throw new Error('工作区包含未知指标。');
  if(!Array.isArray(value.alerts)||value.alerts.some(alert=>!alert||typeof alert.id!=='string'||typeof alert.symbol!=='string'||!['above','below'].includes(alert.direction)||!Number.isFinite(alert.price)||alert.price<=0))throw new Error('工作区提醒格式无效。');
  for(const [symbol,item] of Object.entries(value.imports||{})){if(!symbol.startsWith('CSV:')||!Array.isArray(item.candles))throw new Error('工作区本地行情格式无效。');parseCandlesCsv(exportCandlesCsv(item.candles));}
  return {...structuredClone(defaults),...value,theme:value.theme==='light'?'light':'dark',chartType:['candle_solid','area','ohlc','candle_hollow'].includes(value.chartType)?value.chartType:'candle_solid',secondaryInterval:['1m','5m','15m','30m','1h','4h','1d','1w'].includes(value.secondaryInterval)?value.secondaryInterval:'1h'};
}
function connectMarket(){if(!payload||!state.autoRefresh||state.imports[state.symbol]||!enabledSymbol(state.symbol)){liveFeed.close();return;}liveFeed.connect(state.symbol,state.interval,state.watchlist.filter(enabledSymbol),state.dual?state.secondaryInterval:null);}
function paintQuoteOnLastBar(quote){
  const span={'1m':60_000,'5m':300_000,'15m':900_000,'30m':1_800_000,'1h':3_600_000,'4h':14_400_000,'1d':86_400_000,'1w':604_800_000}[state.interval];
  const last=allCandles.at(-1);
  if(!last||!span||last.closed===true||replay||!Number.isFinite(quote?.price)||quote.price<=0||!Number.isFinite(quote.timestamp))return;
  if(quote.timestamp<last.timestamp||quote.timestamp>=last.timestamp+span)return;
  const bar={...last,close:quote.price,high:Math.max(last.high,quote.price),low:Math.min(last.low,quote.price)};
  allCandles[allCandles.length-1]=bar;chart.updateData(bar);
}
function applyLiveEvent(event){
  if(event.type==='alert'){applyAlert(event);return;}
  if(event.type==='quote'){
    const old=quotes.get(event.symbol);if(!old?.timestamp||event.quote.timestamp>=old.timestamp)quotes.set(event.symbol,event.quote);
    if(event.symbol===state.symbol&&payload&&!replay&&(!payload.quote.timestamp||event.quote.timestamp>=payload.quote.timestamp)){
      payload.quote=event.quote;liveMeta=event.meta;if(event.meta.feedType==='push'&&!event.cached)streamState='live';paintQuoteOnLastBar(event.quote);renderHeader();
    }
    renderWatchlist();return;
  }
  if(event.type==='candle'&&secondaryChart&&!replay&&event.symbol===state.symbol&&event.interval===state.secondaryInterval){const last=secondaryChart.getDataList().at(-1);if(last&&event.candle.timestamp>=last.timestamp)secondaryChart.updateData(event.candle);}
  if(event.type==='candle'&&payload&&!replay&&event.symbol===state.symbol&&event.interval===state.interval){
    const last=allCandles.at(-1),bar={...event.candle,sourceTime:event.meta.sourceTime};if(!last||bar.timestamp<last.timestamp)return;
    if(bar.timestamp===last.timestamp)allCandles[allCandles.length-1]=bar;else allCandles.push(bar);
    chart.updateData(bar);liveMeta=event.meta;streamState='live';renderHeader();
  }
}
function updateLiveStatus(event){
  if(event.provider==='connection'||event.provider==='binance-ws'&&/USDT$|USDC$|FDUSD$/.test(state.symbol)||event.provider==='tqsdk'&&state.symbol.startsWith('TQ:')){
    const previous=streamState;streamState=event.status;
    if((event.status==='live'||event.status==='connected')&&['reconnecting','stale'].includes(previous)&&payload&&!gapRepair){gapRepair=refreshCurrent().finally(()=>{gapRepair=null;});}
    if(payload&&!replay)renderHeader();
  }
}
function applySharedChart(next){
  const changedView=next.symbol!==state.symbol||next.interval!==state.interval,oldCode=state.pineCode;
  sharedApplying=true;
  try{
      if(changedView){exitReplay(false);stopPine();restoringDrawings=true;try{chart.removeOverlay({groupId:'user-drawings'});drawingIds.clear();currentTool='';}finally{restoringDrawings=false;}renderDrawingTools();}
    Object.assign(state,structuredClone(next));$('#chart-type').value=state.chartType;
    drawingHistory.observe(drawingKey(),state.drawings[drawingKey()]||[]);
    styleChart(chart);syncIndicators();for(const name of state.indicators)if(subPanes.has(name)&&state.indicatorParams[name])chart.overrideIndicator({name,calcParams:state.indicatorParams[name]},subPanes.get(name));
    if(changedView)loadSymbol();else if(payload)restoreDrawings();
    if(oldCode!==state.pineCode&&$('#pine-code'))$('#pine-code').value=state.pineCode;
    if(activeTab==='collab')renderCollaborationStatus();
  }finally{sharedApplying=false;}
}
function drawSharedNotes(){
  if(!chart)return;chart.removeOverlay({groupId:'shared-notes'});
  for(const note of Object.values(state.notes||{}))if(note.symbol===state.symbol&&note.interval===state.interval&&Number.isFinite(note.timestamp)&&Number.isFinite(note.price))chart.createOverlay({id:`note-${note.id}`,name:'simpleAnnotation',groupId:'shared-notes',lock:true,points:[{timestamp:note.timestamp,value:note.price}],extendData:note.text.slice(0,90)});
}
function collaborationChanged(client){
  const pending=client.canEdit?diffChartStates(client.base.state,chartStateFromWorkspace(state)):[];
  if(client.canEdit&&(pending.length||client.conflicts.length))localStorage.setItem('shanhai-chart-draft',JSON.stringify({base:client.base,local:chartStateFromWorkspace(state),conflicts:client.conflicts}));else localStorage.removeItem('shanhai-chart-draft');
  const collabLabel=client.conflicts.length?'协作，有冲突':client.saving?'协作，正在保存':`协作，修订 ${client.base.revision}`;
  $('#collab-button').innerHTML=icon('users');$('#collab-button').title=collabLabel;$('#collab-button').setAttribute('aria-label',collabLabel);
  $('#collab-button').classList.toggle('has-conflict',Boolean(client.conflicts.length));
  if(activeTab==='collab')renderCollaborationStatus();
}
async function importWorkspace(next){
  if(connection?.role==='reader')throw new Error('导入共享图表需要编辑凭据。');
  let current=await api('/api/chart?room=main');const operations=diffChartStates(current.state,chartStateFromWorkspace(next));
  for(let index=0;index<operations.length;index+=100)current=await api('/api/chart/operations?room=main',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:current.revision,batchId:newId(),actor,operations:operations.slice(index,index+100)})});
  if(connection.local)await api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});else localStorage.setItem('shanhai-workspace',JSON.stringify(next));
  localStorage.removeItem('shanhai-chart-draft');location.reload();
}
function renderCollaboration(){
  const readonly=connection?.role==='reader';
  $('#panel-content').innerHTML=`<div class="collab-layout"><div><div id="collab-state"></div><form id="actor-form" class="collab-actor"><label>编辑者名称<input id="actor-name" aria-label="编辑者名称" maxlength="80" value="${esc(actor.name)}"></label><button class="secondary">更新名称</button>${connection?.local?'<button type="button" class="quiet" id="show-access">局域网连接凭据</button>':''}</form><form id="note-form"><label class="note-label">添加共享批注<textarea name="text" aria-label="共享批注内容" maxlength="2000" placeholder="记录观察、价位或让 Agent 参考的假设…" required ${readonly?'disabled':''}></textarea></label><div class="note-actions"><label><input type="checkbox" name="anchor" checked> 锚定当前最新 K 线与价格</label><button class="primary" ${readonly?'disabled':''}>发布批注</button></div></form><div id="shared-note-list"></div></div><div class="collab-guide"><h3>人和 Agent 共用一张图</h3><p>共享标的、周期、指标、画线、Pine 源码与批注。每次修改带版本号；发生冲突时保留你的草稿，等待合并。</p><p>局域网：${connection?.mode==='lan'?'已启用':'未开启；请使用局域网启动器'}</p>${(connection?.urls||[]).map(url=>`<p class="lan-url">${esc(url)}</p>`).join('')}<p>MCP 地址为上方主机地址加 <code>/mcp</code>。Agent 通过 Bearer 凭据接入，可读取行情、计算指标和运行基础回测；编辑凭据还可提交画线与批注。</p><div id="agent-research"></div><h3>最近修改</h3><div id="chart-history">读取中…</div></div></div>`;
  $('#actor-form').onsubmit=event=>{event.preventDefault();actor.name=$('#actor-name').value.trim()||'图表研究者';localStorage.setItem('shanhai-actor-name',actor.name);toast('编辑者名称已更新。');};
  $('#note-form').onsubmit=event=>{event.preventDefault();if(readonly)return;const values=new FormData(event.target),last=allCandles.at(-1),note={id:newId(),symbol:state.symbol,interval:state.interval,text:String(values.get('text')).trim()};if(!note.text)return;if(values.has('anchor')&&last){note.timestamp=last.timestamp;note.price=payload?.quote.price||last.close;}state.notes[note.id]=note;event.target.reset();drawSharedNotes();scheduleSave();renderCollaborationStatus();};
  if($('#show-access'))$('#show-access').onclick=showAccess;
  mountAgentResearch({container:$('#agent-research'),api,context:{symbol:state.symbol,interval:state.interval,ready:Boolean(payload),backtestOptions:structuredClone(state.backtestOptions)},canEdit:!readonly,esc,toast,download,publish:note=>{const id=newId();state.notes[id]={id,...note};drawSharedNotes();scheduleSave();renderCollaborationStatus();}});
  renderCollaborationStatus();
}
function renderCollaborationStatus(){
  if(!$('#collab-state')||!collaboration)return;
  const c=collaboration,pending=c.canEdit?diffChartStates(c.base.state,chartStateFromWorkspace(state)).length:0;
  $('#collab-state').innerHTML=`<h3>共享图表 <span class="revision">r${c.base.revision}</span></h3><p class="search-hint">${connection.role==='reader'?'只读访问':connection.local?'主机编辑者':'局域网编辑者'} · ${esc(c.status==='connected'?'已连接':c.status==='reconnecting'?'重连中':c.status)} · ${c.saving?'正在保存':pending?`${pending} 项草稿修改`:'修改已同步'}</p>${c.conflicts.length?`<div class="conflict-box"><strong>检测到同时修改，草稿已保留</strong><p>${c.conflicts.map(esc).join('、')}</p><button class="secondary" id="use-remote">采用共享版本</button><button class="primary" id="keep-local">保留我的修改并提交</button></div>`:''}`;
  if($('#use-remote'))$('#use-remote').onclick=()=>collaboration.resolve('remote');if($('#keep-local'))$('#keep-local').onclick=()=>collaboration.resolve('local');
  const notes=Object.values(state.notes||{}).filter(n=>n.symbol===state.symbol&&n.interval===state.interval).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  $('#shared-note-list').innerHTML=notes.map(n=>`<article class="shared-note"><div><strong>${esc(n.author?.name||actor.name)}</strong><span>${esc(n.author?.kind==='agent'?'Agent':'人')} · ${esc(n.price?fmt(n.price):'自由批注')}</span>${connection.role!=='reader'?`<button class="quiet" data-remove-note="${esc(n.id)}">删除</button>`:''}</div><p>${esc(n.text)}</p></article>`).join('')||'<p class="search-hint">当前标的和周期暂无批注。</p>';
  $$('[data-remove-note]').forEach(button=>button.onclick=()=>{delete state.notes[button.dataset.removeNote];drawSharedNotes();scheduleSave();renderCollaborationStatus();});
  const revision=c.base.revision;api(`/api/chart/history?room=main&after=${Math.max(0,revision-15)}&limit=15`).then(value=>{if(!$('#chart-history')||collaboration.base.revision!==revision)return;$('#chart-history').innerHTML=value.changes.slice().reverse().map(change=>`<div class="history-row"><b>r${change.revision}</b><span>${esc(change.actor.name)} · ${change.actor.kind==='agent'?'Agent':'人'}</span><small>${change.operations.length} 项 · ${esc(date(change.at))}</small></div>`).join('')||'<p class="search-hint">尚无共享修改。</p>';}).catch(()=>{if($('#chart-history'))$('#chart-history').textContent='修改记录暂不可用。';});
}
async function showAccess(){
  try{const value=await api('/api/access');openModal('局域网与 Agent 连接',`<p class="search-hint">${value.mode==='lan'?'同一局域网的设备可访问下列地址。':'当前仅监听本机；使用局域网启动器后可供其他电脑连接。'}</p>${value.urls.map(url=>`<p class="lan-url">${esc(url)} · MCP: ${esc(url)}/mcp</p>`).join('')}<p>只读凭据用于查询行情和图表；编辑凭据允许修改共享图表。</p>${['reader','editor'].map(role=>`<div class="access-row"><label>${role==='reader'?'只读':'编辑'}凭据<input type="password" id="token-${role}" readonly autocomplete="off"></label><button class="secondary" data-copy-token="${role}">复制</button></div>`).join('')}<p class="search-hint">凭据仅在本机此处展示，不写入分享链接。其他电脑打开界面后输入凭据即可。</p>`);for(const role of ['reader','editor'])$(`#token-${role}`).value=value.credentials[role];$$('[data-copy-token]').forEach(button=>button.onclick=async()=>{const role=button.dataset.copyToken;try{await navigator.clipboard.writeText(value.credentials[role]);toast('连接凭据已复制。');}catch{const input=$(`#token-${role}`);input.type='text';input.select();toast('请复制选中的连接凭据。');}});}catch(error){toast(error.message);}
}
function showLogin(){
  $('#chart-message').classList.add('hidden');openModal('连接山海局域网工作区',`<p class="search-hint">向主机上的研究者获取只读或编辑凭据。无需行情平台账户。</p><form id="lan-login"><label class="note-label">连接凭据<input id="lan-token" type="password" autocomplete="off" required></label><p id="login-error" class="inline-error"></p><button class="primary">连接工作区</button></form>`);
  $('#lan-login').onsubmit=async event=>{event.preventDefault();try{await api('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:$('#lan-token').value.trim()})});$('#modal').close();await boot();}catch(error){$('#login-error').textContent=error.message;}};
}
function openResearch(){
  openModal('REA 调查与本地实现',`<div class="research-title"><span class="research-status">0.4 · 本机验证</span></div><div class="modal-section"><h3>REA 的作用</h3><p><a href="https://github.com/morluto/rea" target="_blank" rel="noreferrer">morluto/rea</a> 是分析工具，提供浏览器观察、脚本与二进制分析能力。本项目用它调查公开页面；图表、行情和计算模块由独立开源组件实现。</p><p>Pine Script 在 TradingView 服务器运行。网页观察无法恢复没有下发的闭源指标，也不能证明本地实现与完整 TradingView 等价。</p></div><div class="modal-section"><h3>当前已经实现</h3><ul class="progress-list"><li><span>01</span>多市场真实 OHLCV、自选搜索、来源与延迟说明、下载缓存</li><li><span>02</span>多周期、技术指标、趋势线/水平线/斐波那契、保存布局</li><li><span>03</span>双图对照、历史逐根回放、价格提醒、CSV 导入导出</li><li><span>04</span>原生 Pine v5/v6 常见指标与实验策略、独立工作线程执行</li><li><span>05</span>EMA / RSI / 买入持有回测、下一开盘成交、费用/滑点与交易记录</li><li><span>06</span>局域网人 / Agent 协作、指标与基础回测接口、带来源的共享批注</li></ul></div><div class="modal-section"><h3>尚未达到完整 TradingView 的部分</h3><ul><li>全市场交易所级实时行情、完整交易日历与长期历史</li><li>完整 Pine 兼容、动态/低周期 request 请求、复杂绘图与全部策略撮合规则（目前支持独立标的与 Binance 更高周期）</li><li>长期无人值守云端提醒、券商下单与账户同步</li><li>交易日历、合约乘数、换月、整手/卖空限制与换汇</li></ul></div><div class="modal-section"><h3>组件与许可</h3><p><a href="https://github.com/klinecharts/KLineChart" target="_blank" rel="noreferrer">KLineCharts 9.8.12</a> · Apache-2.0<br><a href="https://github.com/LuxAlgo/PineTS" target="_blank" rel="noreferrer">PineTS 0.11.1</a> · AGPL-3.0-only<br><a href="https://github.com/morluto/rea" target="_blank" rel="noreferrer">REA 6.5.0</a> · MIT</p></div>`);
}
async function refreshCurrent(){
  const id=loadingId,symbol=state.symbol,interval=state.interval,startedAt=Date.now();
  try{
    const value=await api(`/api/candles?${new URLSearchParams({symbol,interval,limit:800,refresh:'1'})}`);if(id!==loadingId||replay)return;
    const lastTime=allCandles.at(-1)?.timestamp,recent=allCandles.filter(bar=>bar.sourceTime>=startedAt),oldQuote=payload?.quote;
    allCandles=[...new Map([...value.candles,...recent].map(bar=>[bar.timestamp,bar])).values()].sort((a,b)=>a.timestamp-b.timestamp);payload={...value,candles:allCandles,quote:oldQuote?.timestamp>value.quote.timestamp?oldQuote:value.quote};quotes.set(symbol,payload.quote);
    if(lastTime&&allCandles.some(bar=>bar.timestamp===lastTime)){for(const bar of allCandles.filter(bar=>bar.timestamp>=lastTime))chart.updateData(bar);}else chart.applyNewData(allCandles,false);
    renderHeader();renderWatchlist();if(activeTab==='data')renderData();
    if(state.dual)loadSecondary({refresh:true});
  }catch(error){$('#connection-status').textContent=`更新失败：${error.message}`;}
}
const layoutModules=[['chart','shanhai-hide-chart','chart-collapsed'],['watchlist','shanhai-hide-watchlist','watchlist-collapsed'],['research','shanhai-hide-research','research-collapsed'],['range','shanhai-hide-range','range-collapsed']];
async function applyImportedConfig(result){
  state.watchlist=result.watchlist;
  if(result.indicators?.length)for(const name of result.indicators)if(!state.indicators.includes(name))state.indicators.push(name);
  if(result.indicatorParams)state.indicatorParams={...state.indicatorParams,...result.indicatorParams};
  if(result.chartType){state.chartType=result.chartType;$('#chart-type').value=state.chartType;if(chart)styleChart(chart);}
  const intervalChanged=result.interval&&result.interval!==state.interval;
  const symbolChanged=result.symbol&&result.symbol!==state.symbol;
  if(intervalChanged)state.interval=result.interval;
  syncIndicators();renderWatchlist();
  if(symbolChanged)await selectSymbol(result.symbol);
  else if(intervalChanged)await loadSymbol();
  else scheduleSave();
  const ignored=result.ignored.length?`未导入：${result.ignored.slice(0,8).join('、')}`:'';
  toast(`已合并 ${result.added.length} 个自选。${ignored}`);
}
async function importConfigFile(file){
  try{
    if(file.size>1024*1024)throw new Error('配置文件不能超过 1 MB。');
    await applyImportedConfig(importTradingViewConfig(await file.text(),{watchlist:state.watchlist,supportedIndicators}));
  }catch(error){toast(`导入失败：${error.message}`);}
}
async function importLocalTradingView(){
  const button=$('#import-local-tv');button.disabled=true;
  try{
    const found=await api('/api/tv-local');
    const looked=found.searched?.filter(item=>item.exists).map(item=>item.path).slice(0,6).join('；')||'没有命中的目录';
    if(!found.symbols?.length&&!found.indicators?.length){toast(`没有读到可合并的代码或指标。${(found.ignored||[]).join('、')}。查看了：${looked}`);return;}
    const result=importTradingViewConfig(JSON.stringify({symbols:found.symbols,indicators:found.indicators}),{watchlist:state.watchlist,supportedIndicators});
    result.ignored=[...new Set([...result.ignored,...(found.ignored||[])])];
    await applyImportedConfig(result);
  }catch(error){toast(`导入失败：${error.message}`);}
  finally{button.disabled=false;}
}
function drawAgentMarks(annotations){
  const last=allCandles.at(-1);if(!last)throw new Error('当前没有 K 线。');
  const start=allCandles.at(-30)||allCandles[0];
  for(const item of annotations||[]){
    if(item.kind==='range'&&Number.isFinite(item.price2))placeOverlay({name:'rect',points:[{timestamp:start.timestamp,value:item.price},{timestamp:last.timestamp,value:item.price2}],styles:{line:{color:'#d4a94e',size:1}}});
    else if(item.kind==='text')placeOverlay({name:'localNote',points:[{timestamp:last.timestamp,value:item.price}],extendData:item.text||'Agent'});
    else{placeOverlay({name:'horizontalStraightLine',points:[{timestamp:last.timestamp,value:item.price}],styles:{line:{color:'#d4a94e',size:1}}});if(item.text)placeOverlay({name:'localNote',points:[{timestamp:last.timestamp,value:item.price}],extendData:item.text});}
  }
  commitDrawings();
}
let agentConfigured=false;
function refreshAgentButton(){const button=$('#agent-run');if(!button)return;button.disabled=!(payload&&(agentConfigured||$('#agent-key').value.trim()));}
async function loadAgentStatus(){
  try{
    const status=await api('/api/agent/status');
    agentConfigured=Boolean(status.configured);
    $('#agent-model').innerHTML=(status.models||['gpt-4o-mini']).map(model=>`<option ${model===status.model?'selected':''}>${esc(model)}</option>`).join('');
    if(status.baseUrl)$('#agent-base').value=status.baseUrl;
    $('#agent-key-state').textContent=status.configured?'本机 key 已配置':'缺少 API key';
    $('#agent-hint').textContent=status.configured?'将读取当前图表的真实 K 线，把模型返回的水平线、文字或区间画到图上。':`缺少配置：${(status.missing||[]).join('；')}`;
  }catch(error){$('#agent-key-state').textContent='配置不可用';$('#agent-hint').textContent=error.message;}
  refreshAgentButton();
}
function applyLayoutChrome(){
  const hidden=Object.fromEntries(layoutModules.map(([name,key])=>[name,localStorage.getItem(key)==='1']));
  if(matchMedia('(max-width:800px)').matches&&!document.body.classList.contains('watchlist-mobile-open'))hidden.watchlist=true;
  for(const [name,,className] of layoutModules)document.body.classList.toggle(className,hidden[name]);
  document.body.classList.toggle('watchlist-visible',!hidden.watchlist);
  for(const [id,name,label,glyph] of [['toggle-research','research','研究面板','panel'],['toggle-watchlist','watchlist','自选报价','layout']]){
    const button=$(`#${id}`);if(!button)continue;
    button.innerHTML=icon(glyph);
    button.classList.toggle('active',!hidden[name]);
    button.setAttribute('aria-pressed',String(!hidden[name]));
    button.title=`${hidden[name]?'显示':'隐藏'}${label}`;button.setAttribute('aria-label',button.title);
  }
  $$('[data-module]').forEach(input=>{input.checked=!hidden[input.dataset.module];});
  requestAnimationFrame(()=>{refreshPanelLayout();chart?.resize();secondaryChart?.resize();});
}
function setModule(name,visible){
  const key=layoutModules.find(item=>item[0]===name)?.[1];if(!key)return;
  if(name==='watchlist'&&matchMedia('(max-width:800px)').matches)document.body.classList.toggle('watchlist-mobile-open',visible);
  localStorage.setItem(key,visible?'0':'1');applyLayoutChrome();
}
function attachEvents(){
  matchMedia('(max-width:800px)').addEventListener('change',()=>{document.body.classList.remove('watchlist-mobile-open');applyLayoutChrome();});
  for(const [id,glyph] of [['indicators-button','indicators'],['alert-button','alert'],['replay-button','replay'],['research-button','book'],['collab-button','users'],['export-workspace','download'],['save-layout','save'],['chart-type-button','candle'],['module-button','panel'],['import-local-tv','download'],['import-config','file'],['fit-button','fit'],['refresh-button','refresh'],['replay-next','step'],['replay-exit','close'],['drawing-delete','trash'],['drawing-copy','copy'],['drawing-edit-text','edit'],['drawing-lock','lock']])$(`#${id}`).innerHTML=icon(glyph);
  $('.picker-search').innerHTML=icon('search');
  for(const [scale,glyph] of [['normal','linear'],['log','log'],['percentage','percent']]){const button=$(`[data-price-scale="${scale}"]`);if(button)button.innerHTML=icon(glyph);}
  $('#layout-button').innerHTML=icon('layout');$('#snapshot-button').innerHTML=icon('camera');$('#add-watchlist').innerHTML=icon('plus');
  for(const [id,glyph] of [['undo-drawing','undo'],['redo-drawing','redo'],['chart-settings-button','settings'],['fullscreen-button','fullscreen']])$(`#${id}`).innerHTML=icon(glyph);
  $('#undo-drawing').onclick=()=>undoDrawings();$('#redo-drawing').onclick=()=>undoDrawings(true);
  $('#chart-settings-button').onclick=openChartSettings;$('#fullscreen-button').onclick=toggleFullscreen;
  $$('[data-price-scale]').forEach(button=>button.onclick=()=>applyChartPreferences({scale:button.dataset.priceScale}));
  $('#chart-type-button').onclick=event=>{const rect=event.currentTarget.getBoundingClientRect();openChartMenu(rect.left,rect.bottom+4,'type');};
  if(!$('#price-plus')){
    const plus=document.createElement('div');plus.id='price-plus';plus.className='price-plus hidden';
    plus.innerHTML=`<span id="price-plus-label" class="price-plus-label"></span><button type="button" id="price-plus-button" aria-label="在此价格添加">${icon('plus')}</button>`;
    $('#chart-area').append(plus);
    plus.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();});
    $('#price-plus-button').onclick=event=>{
      event.preventDefault();event.stopPropagation();
      const y=Number(plus.dataset.clientY);
      if(!Number.isFinite(priceAtClientY(y)))return;
      const rect=event.currentTarget.getBoundingClientRect();
      openChartMenu(rect.left,rect.bottom+4,'plus',y,rect.left);
    };
  }
  $('#chart-area').addEventListener('pointermove',movePricePlus);
  $('#chart-area').addEventListener('pointerleave',event=>{if(!event.relatedTarget?.closest?.('#price-plus'))hidePricePlus();});
  $('#chart-area').addEventListener('contextmenu',event=>{
    event.preventDefault();
    if(event.target.closest?.('#price-plus'))return;
    if(drawingMenuFromOverlay){drawingMenuFromOverlay=false;return;}
    hidePricePlus();
    const box=$('#chart')?.getBoundingClientRect();
    const main=chart?.getDom?.('candle_pane','main')?.getBoundingClientRect();
    const onPrice=Boolean(event.target.closest?.('[data-axis="price"]'));
    const inCandle=main&&event.clientX>=main.left&&event.clientX<=main.right&&event.clientY>=main.top&&event.clientY<=main.bottom;
    const onTime=!onPrice&&!inCandle&&box&&event.clientY>box.bottom-24&&event.clientX<box.right-8;
    openChartMenu(event.clientX,event.clientY,onPrice?'price':onTime?'time':'chart');
  });
  document.addEventListener('pointerdown',event=>{if(chartContextMenu&&!chartContextMenu.contains(event.target))closeChartMenu();});
  window.addEventListener('resize',closeChartMenu);
  document.addEventListener('fullscreenchange',()=>{const full=Boolean(document.fullscreenElement);$('#fullscreen-button').classList.toggle('active',full);$('#fullscreen-button').title=full?'退出全屏':'图表全屏';$('#fullscreen-button').setAttribute('aria-label',$('#fullscreen-button').title);chart?.resize();secondaryChart?.resize();});
  $('#hide-research').innerHTML=icon('collapse');$('#hide-watchlist').innerHTML=icon('collapseRight');
  $('#hide-research').onclick=()=>{setModule('research',false);$('#toggle-research').focus();};
  $('#hide-watchlist').onclick=()=>{setModule('watchlist',false);$('#toggle-watchlist').focus();};
  $('#symbol-picker').onclick=openSearch;$('#add-watchlist').onclick=openSearch;$('#indicators-button').onclick=openIndicators;$('#alert-button').onclick=()=>setTab('alerts');$('#research-button').onclick=openResearch;$('#collab-button').onclick=()=>setTab('collab');
  $('#theme-button').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();scheduleSave();};$('#save-layout').onclick=()=>saveState();$('#export-workspace').onclick=()=>{serializeDrawings();downloadJson('山海-工作区.json',state);};
  $('#refresh-button').onclick=async()=>{await loadSymbol({refresh:true});refreshWatchlist();};$('#auto-refresh').checked=state.autoRefresh;$('#auto-refresh').onchange=event=>{state.autoRefresh=event.target.checked;scheduleSave();};
  $$('#periods button').forEach(button=>button.onclick=()=>selectInterval(button.dataset.interval));$$('[data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));
  $('#chart-type').value=state.chartType;$('#chart-type').onchange=event=>{state.chartType=event.target.value;styleChart(chart);if(secondaryChart)styleChart(secondaryChart);scheduleSave();};$('#layout-button').onclick=toggleLayout;
  $('#snapshot-button').onclick=()=>{if(!allCandles.length)return;const a=document.createElement('a');a.href=chart.getConvertPictureUrl(true,'png',chartColors().bg);a.download=`${state.symbol}-${state.interval}.png`;a.click();};
  $('#replay-button').onclick=()=>replay?exitReplay():startReplay();$('#replay-exit').onclick=()=>exitReplay();$('#replay-next').onclick=advanceReplay;
  $('#replay-play').onclick=()=>{if(replayTimer)stopReplayTimer();else{if(replayCount>=allCandles.length)replayCount=2;$('#replay-play').innerHTML=icon('pause');replayTimer=setInterval(advanceReplay,650);}};
  $('#replay-slider').oninput=event=>{stopReplayTimer();replayCount=Number(event.target.value);applyReplay();};
  $$('[data-market]').forEach(button=>button.onclick=()=>{marketFilter=button.dataset.market;$$('[data-market]').forEach(item=>item.classList.toggle('selected',item===button));renderWatchlist();});
  $$('[data-range]').forEach(button=>button.onclick=()=>{const bars=visibleCandles();if(!bars.length)return;const from=button.dataset.range==='all'?0:bars.findIndex(bar=>bar.timestamp>=bars.at(-1).timestamp-Number(button.dataset.range)*86400000);const count=Math.max(5,bars.length-Math.max(0,from));chart.setBarSpace(Math.max(1,Math.min(40,($('#chart').clientWidth-65)/count)));chart.scrollToRealTime();$$('[data-range]').forEach(item=>item.classList.toggle('selected',item===button));});
  $('#fit-button').onclick=fitChart;
  $('#toggle-research').onclick=()=>setModule('research',document.body.classList.contains('research-collapsed'));
  $('#toggle-watchlist').onclick=()=>setModule('watchlist',document.body.classList.contains('watchlist-collapsed'));
  $('#module-button').onclick=()=>{$('#module-menu').classList.toggle('hidden');$('#module-button').setAttribute('aria-expanded',String(!$('#module-menu').classList.contains('hidden')));};
  $$('[data-module]').forEach(input=>input.onchange=()=>setModule(input.dataset.module,input.checked));
  $('#import-config').onclick=()=>$('#tv-import-file').click();
  $('#import-local-tv').onclick=()=>importLocalTradingView();
  $('#tv-import-file').onchange=event=>{const file=event.target.files?.[0];event.target.value='';if(file)importConfigFile(file);};
  $('#drawing-delete').onclick=removeSelectedDrawing;
  $('#drawing-lock').onclick=()=>{const overlay=chart.getOverlayById(selectedDrawing);if(!overlay)return;mutateDrawings(()=>chart.overrideOverlay({id:overlay.id,lock:!overlay.lock}));showSelection(chart.getOverlayById(overlay.id)||overlay);};
  $('#drawing-copy').onclick=copySelectedDrawing;$('#drawing-edit-text').onclick=editDrawingText;
  $('#drawing-color').oninput=updateSelectedStyle;$('#drawing-width').oninput=updateSelectedStyle;
  $('#drawing-line-style').onchange=updateSelectedStyle;
  $('#agent-key').oninput=refreshAgentButton;
  $('#agent-form').onsubmit=async event=>{
    event.preventDefault();if($('#agent-run').disabled)return;
    $('#agent-run').disabled=true;$('#agent-hint').textContent='正在读取真实 K 线并请求模型…';
    try{
      const payloadBody={symbol:state.symbol,interval:state.interval,baseUrl:$('#agent-base').value.trim(),model:$('#agent-model').value};
      const typed=$('#agent-key').value.trim();if(typed)payloadBody.apiKey=typed;
      const result=await api('/api/agent/annotate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payloadBody)});
      $('#agent-key').value='';agentConfigured=true;$('#agent-key-state').textContent='本机 key 已配置';
      drawAgentMarks(result.annotations);
      $('#agent-hint').textContent=`已根据 ${result.bars} 根真实 K 线画上 ${result.annotations.length} 条标注。`;
      toast(`Agent 已标注 ${result.annotations.length} 处。`);
    }catch(error){$('#agent-hint').textContent=error.message;toast(error.message);}
    finally{refreshAgentButton();}
  };
  $('#csv-file').onchange=event=>importCsv(event.target.files[0]);
  $('#workspace-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>4*1024*1024)throw new Error('工作区文件不能超过 4 MB。');await importWorkspace(validateState(JSON.parse(await file.text())));}catch(error){toast(`导入失败：${error.message}`);}event.target.value='';};
  $('#modal').onclick=event=>{if(event.target===$('#modal'))$('#modal').close();};
  document.addEventListener('keydown',event=>{
    const action=matchShortcut(event);if(!action)return;
    if($('#modal').open&&action!=='save'&&action!=='escape')return;
    const tools={trend:'segment',horizontal:'horizontalStraightLine',vertical:'verticalStraightLine',cross:'crossLine',fib:'fibonacciLine',rect:'rect',note:'localNote',ruler:'datePriceRange',ray:'rayLine',extended:'straightLine','horizontal-ray':'horizontalRayLine','horizontal-segment':'horizontalSegment',channel:'parallelStraightLine','price-channel':'priceChannelLine','fib-extension':'fibExtension',circle:'localCircle',triangle:'localTriangle',arrow:'arrowLine','price-line':'priceLine','price-tag':'simpleTag','price-range':'priceRange','date-range':'dateRange'};
    if(action==='save'){event.preventDefault();saveState();return;}
    if(action==='escape'){if($('#modal').open)$('#modal').close();closeChartMenu();cancelDrawing();hideSelection();return;}
    event.preventDefault();
    if(action==='undo')undoDrawings();
    else if(action==='redo')undoDrawings(true);
    else if(action==='delete'&&selectedDrawing)removeSelectedDrawing();
    else if(tools[action])beginDrawing(tools[action]);
    else if(action==='hide')toggleDrawingVisibility();
    else if(action==='lock')mutateDrawings(()=>chart.overrideOverlay({groupId:'user-drawings',lock:!drawingsLocked}));
    else if(action==='indicators')openIndicators();
    else if(action==='fit')fitChart();
    else if(action==='reset')resetChartView();
    else if(action==='alert')addPriceAlert(chartPointer.price);
    else if(action==='lock-cursor')toggleCursorLock(chartPointer.timestamp);
    else if(action==='search')openSearch();
    else if(action==='pan-left')chart?.scrollByDistance(-80);
    else if(action==='pan-right')chart?.scrollByDistance(80);
    else if(action==='zoom-in')zoomChart(1);
    else if(action==='zoom-out')zoomChart(-1);
    else if(action==='interval-prev')stepInterval(-1);
    else if(action==='interval-next')stepInterval(1);
  });
  setInterval(()=>{if(!state.autoRefresh||replay||autoBusy||document.hidden||state.imports[state.symbol])return;autoBusy=true;refreshCurrent().then(()=>refreshWatchlist()).finally(()=>{autoBusy=false;});},60_000);
  setInterval(()=>{if(state.autoRefresh&&!replay&&!autoBusy&&!document.hidden&&payload?.meta.provider==='sina'){autoBusy=true;refreshCurrent().finally(()=>{autoBusy=false;});}},10000);
  setInterval(()=>{if(payload&&!replay)renderHeader();},1000);
  const tick=()=>{$('#clock').textContent=new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' UTC+8';};tick();setInterval(tick,1000);
}
async function boot(){
  try{
    connection=await api('/api/connection');$('[data-tab="accounts"]').classList.toggle('hidden',!connection.features?.domesticFutures);const [hostSaved,list,snapshot]=await Promise.all([api('/api/state'),api('/api/catalog'),api('/api/chart?room=main')]);let saved=hostSaved;if(!connection.local)try{saved=JSON.parse(localStorage.getItem('shanhai-workspace')||'{}');}catch{}if(saved.schemaVersion)try{state=validateState(saved);}catch(error){toast(`保存的工作区有异常，已使用默认布局：${error.message}`);}Object.assign(state,structuredClone(snapshot.state));catalog=list.results;
    for(const [symbol,value] of Object.entries(state.imports))catalog.push({symbol,name:value.meta?.name||symbol,market:'local',exchange:'LOCAL'});
    const dual=state.dual;state.dual=false;applyLayoutChrome();applyTheme();setupChart();renderDrawingTools();attachEvents();refreshPanelLayout=initPanelLayout();renderWatchlist();renderPanel();await loadAgentStatus();await loadSymbol();if(dual)toggleLayout();
    collaboration=new ChartCollaboration({api,capture:()=>{serializeDrawings();return state;},apply:applySharedChart,changed:collaborationChanged,actor,canEdit:connection.role!=='reader'});
    let draft;try{draft=JSON.parse(localStorage.getItem('shanhai-chart-draft')||'null');}catch{}
    collaboration.start(snapshot);if(connection.role!=='reader'&&draft?.base?.state&&draft?.local){const merged=mergeChartStates(draft.base.state,draft.local,snapshot.state);collaboration.conflicts=[...new Set([...(draft.conflicts||[]),...merged.conflicts])];applySharedChart(merged.state);collaborationChanged(collaboration);collaboration.schedule();}
    refreshWatchlist();
  }catch(error){if(error.status===401){showLogin();return;}$('#chart-message').classList.remove('hidden');$('#chart-message').textContent=`启动失败：${error.message}。请确认本地服务正在运行。`;console.error(error);}
}
boot();
