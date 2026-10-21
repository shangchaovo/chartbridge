import {validWatchlist} from './watchlist-state.js';
import {isReachDirection} from './alerts.js';
import {parseCandlesCsv,exportCandlesCsv} from './csv-data.js';

export const WORKSPACE_SETTING_FIELDS = Object.freeze(['theme','dual','secondaryInterval','watchlist','alerts','alertLogClearedAt','scripts','imports','autoRefresh','backtestOptions']);
export const SYNCED_STORAGE_KEYS = Object.freeze([
  'shanhai-drawing-colors','shanhai-drawing-favorites','shanhai-drawing-tools','shanhai-keep-drawing','shanhai-hide-drawings',
  'shanhai-position-defaults','shanhai-shortcuts','shanhai-chart-preferences','shanhai-chart-templates','shanhai-drawing-panel-position',
  'shanhai-research-body','shanhai-hide-chart','shanhai-hide-watchlist','shanhai-hide-research','shanhai-hide-range',
  'shanhai-research-height','shanhai-watchlist-width',
  'shanhai-magnet','shanhai-market-filter','shanhai-active-tab',
]);
export const sameSetting = (a,b) => JSON.stringify(a??null) === JSON.stringify(b??null);
export function workspaceSettings(value={}) {
  return Object.fromEntries(WORKSPACE_SETTING_FIELDS.filter(key=>value[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
}
export function storageSettings(storage) {
  return Object.fromEntries(SYNCED_STORAGE_KEYS.map(key=>[key,storage.getItem(key)]));
}
export function syncedStorage(storage,changed) {
  return {
    getItem:key=>storage.getItem(key),
    setItem(key,value){const before=storage.getItem(key);storage.setItem(key,value);if(SYNCED_STORAGE_KEYS.includes(key)&&before!==String(value))changed(key);},
    removeItem(key){const before=storage.getItem(key);storage.removeItem(key);if(SYNCED_STORAGE_KEYS.includes(key)&&before!==null)changed(key);},
  };
}
function invalid(message){throw Object.assign(new Error(message),{status:400});}
function safe(value,depth=0){
  if(depth>20)invalid('配置嵌套过深。');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))invalid('配置包含无效属性。');safe(child,depth+1);}
}
export function validateSetting(kind,key,value) {
  if(kind==='preference'){
    if(!SYNCED_STORAGE_KEYS.includes(key))invalid('该浏览器数据不属于同步配置。');
    if(value===null)return;
    if(typeof value!=='string'||value.length>200000)invalid('浏览器配置无效或过大。');
    const choices={'shanhai-magnet':['normal','weak_magnet','strong_magnet'],'shanhai-market-filter':['all','crypto','us','us-binance','etf','cn','hk','forex','futures','indices','global','local'],'shanhai-active-tab':['backtest','pine','data','collab','accounts']};
    if(choices[key]){if(!choices[key].includes(value))invalid('配置选项无效。');}
    else if(/-(?:body|keep-drawing|hide-(?:drawings|chart|watchlist|research|range))$/.test(key)){
      if(!['0','1'].includes(value))invalid('开关配置无效。');
    }else if(/-(?:height|width)$/.test(key)){
      if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>10000)invalid('面板尺寸无效。');
    }else{
      let parsed;try{parsed=JSON.parse(value);}catch{invalid('浏览器配置需要有效 JSON。');}safe(parsed);
      if(!parsed||typeof parsed!=='object')invalid('浏览器配置格式无效。');
    }
    return;
  }
  if(kind!=='field'||!WORKSPACE_SETTING_FIELDS.includes(key))invalid('不能同步该工作区字段。');
  safe(value);
  if(key==='watchlist'&&!validWatchlist(value))invalid('自选列表无效或超过 150 个。');
  if(key==='theme'&&!['light','dark'].includes(value))invalid('主题无效。');
  if(['dual','autoRefresh'].includes(key)&&typeof value!=='boolean')invalid('开关配置无效。');
  if(key==='secondaryInterval'&&!['1m','5m','15m','30m','1h','4h','1d','1w'].includes(value))invalid('对照图周期无效。');
  if(key==='alerts'&&(!Array.isArray(value)||value.length>100||value.some(item=>!item||typeof item.id!=='string'||typeof item.symbol!=='string'||!isReachDirection(item.direction)||!Number.isFinite(item.price)||item.price<=0||(item.message!=null&&(typeof item.message!=='string'||item.message.length>200)))))invalid('提醒配置无效。');
  if(key==='alertLogClearedAt'&&value!==null&&(!Number.isFinite(value)||value<0))invalid('提醒历史时间无效。');
  if(['scripts','imports','backtestOptions'].includes(key)&&(!value||typeof value!=='object'||Array.isArray(value)))invalid('工作区配置格式无效。');
  if(key==='scripts'&&(Object.keys(value).length>100||Object.entries(value).some(([name,code])=>name.length>100||typeof code!=='string'||code.length>100000)))invalid('保存的脚本格式无效或过大。');
  if(key==='imports')for(const [symbol,item] of Object.entries(value)){
    if(!symbol.startsWith('CSV:')||!item||!Array.isArray(item.candles))invalid('本地行情格式无效。');
    try{parseCandlesCsv(exportCandlesCsv(item.candles));}catch(error){invalid(error.message);}
  }
}
export function settingsOperations(base,next) {
  const operations=[];
  for(const [kind,section,keys] of [['field','fields',WORKSPACE_SETTING_FIELDS],['preference','preferences',SYNCED_STORAGE_KEYS]]){
    for(const key of keys){const value=next[section]?.[key]??null,before=base[section]?.[key]??null;
      if(!sameSetting(before,value))operations.push({kind,key,value:structuredClone(value),before:structuredClone(before)});
    }
  }
  return operations;
}
