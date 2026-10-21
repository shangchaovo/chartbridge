import {SYNCED_STORAGE_KEYS,validateSetting,sameSetting,workspaceSettings} from '../src/workspace-settings.js';
import {mergeFiredAlerts} from './price-alerts.mjs';
import {createHash} from 'node:crypto';

const fail=(message,status=400,details)=>{throw Object.assign(new Error(message),{status,details});};
const editor=principal=>{if(!['owner','editor'].includes(principal?.role))fail('只读终端不能修改同步配置。',403);};
export function adoptWorkspaceSettings(store,value,principal){
  editor(principal);if(principal.role!=='owner')fail('请由有权限的终端首次导入现有配置。',403);
  if(typeof value?.source?.id!=='string'||!/^[\w.:-]{1,100}$/.test(value.source.id))fail('初始终端标识无效。');
  if(!value.fields||typeof value.fields!=='object'||!value.preferences||typeof value.preferences!=='object')fail('初始配置格式无效。');
  for(const [key,item] of Object.entries(value.fields))validateSetting('field',key,item);
  for(const [key,item] of Object.entries(value.preferences))validateSetting('preference',key,item);
  const current=store.settings();
  if(current.initialized)fail('已启用双向同步，直接在任意终端修改设置即可。',409,{current});
  const fields=workspaceSettings(value.fields),preferences=Object.fromEntries(SYNCED_STORAGE_KEYS.map(key=>[key,value.preferences[key]??null]));
  store.write(mergeFiredAlerts(store.read(),{...store.read(),...fields}),{initialized:true,source:{id:value.source.id,label:String(value.source.label||'MacBook').slice(0,80)},preferences});
  return store.settings();
}
export function patchWorkspaceSettings(store,value,principal){
  editor(principal);const current=store.settings();
  if(!current.initialized)fail('请先在 MacBook 映射终端导入一次现有配置。',409,{current});
  if(!Number.isSafeInteger(value?.baseRevision)||value.baseRevision<0||value.baseRevision>current.revision)fail('同步版本无效。');
  if(!Array.isArray(value.operations)||value.operations.length>100)fail('配置修改批次无效。');
  let receipt=null;
  if(value.batchId!==undefined){
    if(typeof value.batchId!=='string'||!/^[\w.:-]{1,100}$/.test(value.batchId))fail('配置批次标识无效。');
    const hash=createHash('sha256').update(JSON.stringify({baseRevision:value.baseRevision,operations:value.operations})).digest('hex');
    const saved=store.settingsBatch(value.batchId);
    if(saved){if(saved.hash!==hash)fail('同一批次不能提交不同的配置修改。');return {...current,replayed:true,committedRevision:saved.revision};}
    receipt={id:value.batchId,hash};
  }
  const fields={...current.fields},preferences={...current.preferences},seen=new Set();
  for(const operation of value.operations){
    const {kind,key,value:next}=operation||{};validateSetting(kind,key,next);
    const path=`${kind}/${key}`;if(seen.has(path))fail('同一批次不能重复修改同一配置。');seen.add(path);
    const section=kind==='field'?fields:preferences,saved=section[key]??null;
    if(sameSetting(saved,next))continue;
    // Commit order determines the winner for each explicitly edited setting.
    section[key]=structuredClone(next);
  }
  store.write(mergeFiredAlerts(store.read(),{...store.read(),...fields}),{preferences},receipt);
  return store.settings();
}
