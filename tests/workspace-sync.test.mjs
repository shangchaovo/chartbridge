import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceStore} from '../server/workspace-store.mjs';
import {adoptWorkspaceSettings,patchWorkspaceSettings} from '../server/workspace-settings.mjs';
import {SYNCED_STORAGE_KEYS,workspaceSettings,settingsOperations,syncedStorage,validateSetting} from '../src/workspace-settings.js';
import {WorkspaceSync} from '../src/workspace-sync.js';

const owner={role:'owner'},editor={role:'editor'},reader={role:'reader'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const seed={theme:'dark',watchlist:['AAPL','MSFT'],autoRefresh:true,dual:false,secondaryInterval:'1h',alerts:[],scripts:{},imports:{},backtestOptions:{fast:12,slow:26}};
const adopt=store=>adoptWorkspaceSettings(store,{source:{id:'macbook',label:'MacBook'},fields:seed,preferences:{'shanhai-drawing-colors':'{"color":"#089981","recent":["#089981"]}'}},owner);
const patch=(store,base,kind,key,value,principal=editor)=>patchWorkspaceSettings(store,{baseRevision:base.revision,operations:[{kind,key,value,before:(kind==='field'?base.fields:base.preferences)[key]??null}]},principal);

test('only an explicit source adoption initializes sync and commits preferences and workspace together',()=>{
  const store=new WorkspaceStore(':memory:');try{
    store.write({...seed,theme:'light'});assert.equal(store.settings().initialized,false);
    assert.throws(()=>patch(store,store.settings(),'field','theme','dark'),{status:409});
    const snapshot=adopt(store);assert.equal(snapshot.source.id,'macbook');assert.equal(snapshot.initialized,true);assert.equal(store.read().theme,'dark');
    assert.equal(snapshot.preferences['shanhai-drawing-colors'],'{"color":"#089981","recent":["#089981"]}');
    assert.equal(snapshot.preferences['shanhai-drawing-favorites'],null);assert.equal(store.previous().theme,'light');
  }finally{store.close();}
});
test('three terminals merge independent changes without publishing unrelated stale settings',()=>{
  const store=new WorkspaceStore(':memory:');try{
    const base=adopt(store),events=[];store.on('settings',value=>events.push(value));
    patch(store,base,'field','theme','light');
    patch(store,base,'preference','shanhai-drawing-favorites','{"tools":["segment","rect"],"visible":true}');
    patch(store,base,'preference','shanhai-watchlist-width','340');
    assert.equal(store.read().theme,'light');assert.equal(store.settings().preferences['shanhai-watchlist-width'],'340');
    assert.match(store.settings().preferences['shanhai-drawing-favorites'],/segment/);assert.equal(events.length,3);
    assert.equal(events.at(-1).revision,base.revision+3);
  }finally{store.close();}
});
test('the last committed explicit setting wins across peers, including stale-base edits',()=>{
  const store=new WorkspaceStore(':memory:');try{
    const base=adopt(store);patch(store,base,'field','theme','light');
    patchWorkspaceSettings(store,{baseRevision:base.revision,operations:[{kind:'preference',key:'shanhai-hide-chart',value:'1',before:null},{kind:'field',key:'theme',value:'dark',before:'dark'}]},editor);
    assert.equal(store.settings().preferences['shanhai-hide-chart'],'1');assert.equal(store.read().theme,'dark');
    patch(store,base,'field','watchlist',['AAPL','MSFT','TSLA']);
    patch(store,base,'field','watchlist',['MSFT','NVDA']);
    assert.deepEqual(store.read().watchlist,['MSFT','NVDA']);
    assert.equal(store.settings().source.id,'macbook');
  }finally{store.close();}
});
test('source, colors and settings survive server restart and uncertain retries are idempotent',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'chartbridge-sync-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'workspace.sqlite');let store=new WorkspaceStore(path);
  const base=adopt(store),next=patch(store,base,'preference','shanhai-keep-drawing','1');
  const replay=patch(store,base,'preference','shanhai-keep-drawing','1');assert.equal(replay.revision,next.revision);
  store.close();store=new WorkspaceStore(path);try{assert.deepEqual(store.settings(),next);assert.equal(store.read().theme,'dark');}finally{store.close();}
});
test('read-only, unknown storage, credentials, malformed preferences and duplicate keys cannot be published',()=>{
  const store=new WorkspaceStore(':memory:');try{
    assert.throws(()=>adoptWorkspaceSettings(store,{source:{id:'macbook'},fields:seed,preferences:{}},reader),{status:403});
    const base=adopt(store);
    assert.throws(()=>patch(store,base,'field','theme','light',reader),{status:403});
    for(const [key,value] of [['shanhai-actor-id','other'],['apiKey','secret'],['shanhai-drawing-colors','broken JSON'],['shanhai-watchlist-width','Infinity'],['shanhai-hide-chart','yes']])assert.throws(()=>patch(store,base,'preference',key,value),{status:400});
    assert.throws(()=>patchWorkspaceSettings(store,{baseRevision:base.revision,operations:[{kind:'field',key:'theme',value:'light',before:'dark'},{kind:'field',key:'theme',value:'dark',before:'dark'}]},editor),{status:400});
    assert.deepEqual(store.settings(),base);
  }finally{store.close();}
});
test('stored adapter observes only shared preference changes and never client identities or drafts',()=>{
  const map=new Map(),events=[],raw={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)},storage=syncedStorage(raw,key=>events.push(key));
  storage.setItem('shanhai-actor-id','client');storage.setItem('shanhai-chart-draft','draft');
  storage.setItem('shanhai-watchlist-width','320');storage.setItem('shanhai-watchlist-width','320');storage.removeItem('shanhai-watchlist-width');
  assert.deepEqual(events,['shanhai-watchlist-width','shanhai-watchlist-width']);assert.equal(SYNCED_STORAGE_KEYS.includes('shanhai-actor-id'),false);
});
function client(id,snapshot,local=snapshot){
  let value=structuredClone(local);const map=new Map();
  const instance=new WorkspaceSync({api:async()=>{throw Error('offline');},capture:()=>structuredClone(value),apply:next=>{value=structuredClone(next);},storage:{getItem:key=>map.get(key),setItem:(key,next)=>map.set(key,next),removeItem:key=>map.delete(key)},actor:{id},eventSource:()=>({addEventListener(){},close(){}})});
  instance.base=structuredClone(snapshot);instance.observed=structuredClone(snapshot);return {instance,read:()=>value,edit:(section,key,next)=>{value[section][key]=next;instance.schedule(section==='preferences'?{preferenceKey:key}:{});},map};
}
test('continuous edits flush within the max wait instead of being postponed forever',async()=>{
  const store=new WorkspaceStore(':memory:'),base=adopt(store),a=client('windows',base);let calls=0;
  a.instance.api=async(path,options)=>{patchWorkspaceSettings(store,JSON.parse(options.body),editor);calls++;return store.settings();};
  try{
    // Sustained burst: appended watchlist entries every 100ms for 700ms —
    // longer than maxWaitMs; the debounce alone would postpone each save forever.
    const list=[...a.read().fields.watchlist];
    for(let index=0;index<7;index++){list.push(`SYM${index}`);a.edit('fields','watchlist',[...list]);await sleep(100);}
    assert.ok(calls>=1,'连续编辑期间必须已经发出保存，而不是一直推迟。');
    const saved=store.settings().fields.watchlist;
    await a.instance.flush();
    assert.deepEqual(store.settings().fields.watchlist,list,'保存结束后全部积压编辑必须落库。');
  }finally{a.instance.close();store.close();}
});
test('an edit racing an in-flight save is republished immediately after the save settles',async()=>{
  const store=new WorkspaceStore(':memory:'),base=adopt(store),a=client('windows',base);let reply=null,saved=null,callTimings=[];
  const started=Date.now();
  a.instance.api=async(path,options)=>{const next=patchWorkspaceSettings(store,JSON.parse(options.body),editor);callTimings.push(Date.now()-started);if(callTimings.length===1){saved=next;return new Promise(resolve=>{reply=resolve;});}return next;};
  try{
    a.edit('fields','theme','light');const sending=a.instance.flush();
    a.edit('fields','dual',true);
    reply(saved);
    await sending;
    await sleep(50);
    assert.equal(callTimings.length,2,`竞态编辑应在保存结束后立即重发（实际 ${callTimings.length} 次调用）`);
    assert.equal(store.settings().fields.dual,true);
    assert.ok(callTimings[1]-callTimings[0]<300,`第二次保存应在首次后 ${Math.round(callTimings[1]-callTimings[0])}ms 内发出，而不是再等 1500ms。`);
  }finally{a.instance.close();store.close();}
});
test('every peer preserves explicit pending edits without giving the initial importing device priority',()=>{
  const base={revision:1,initialized:true,source:{id:'macbook'},fields:{theme:'dark',dual:false},preferences:{'shanhai-keep-drawing':'0'}};
  const remote={...structuredClone(base),revision:2};remote.fields.theme='light';
  const a=client('macbook',base),b=client('windows',base);try{
    a.edit('fields','theme','dark');a.edit('fields','dual',true);a.instance.receive(remote);
    assert.equal(a.read().fields.theme,'light');assert.equal(a.read().fields.dual,true);
    b.edit('preferences','shanhai-keep-drawing','1');b.instance.receive(remote);
    assert.equal(b.read().fields.theme,'light');assert.equal(b.read().preferences['shanhai-keep-drawing'],'1');
    const advanced={...structuredClone(remote),revision:3};advanced.preferences['shanhai-drawing-colors']='{"color":"#f23645"}';
    a.edit('preferences','shanhai-drawing-colors','{"color":"#089981"}');a.instance.receive(advanced);
    b.edit('preferences','shanhai-drawing-colors','{"color":"#2962ff"}');b.instance.receive(advanced);
    assert.equal(a.read().preferences['shanhai-drawing-colors'],'{"color":"#089981"}');
    assert.equal(b.read().preferences['shanhai-drawing-colors'],'{"color":"#2962ff"}');
    assert.equal(b.map.has('shanhai-settings-conflict-backup'),false);
  }finally{a.instance.close();b.instance.close();}
});
test('initial publication adopts the MacBook state across other terminals instead of merging their old defaults',()=>{
  const initial={revision:0,initialized:false,fields:{},preferences:{}},other=client('windows',initial,{fields:{theme:'light'},preferences:{'shanhai-drawing-favorites':'{"tools":[]}'}});
  const source={revision:1,initialized:true,source:{id:'macbook'},fields:{theme:'dark'},preferences:{'shanhai-drawing-favorites':'{"tools":["rect"]}'}};
  try{other.instance.receive(source);assert.deepEqual(other.read(),source);assert.ok(other.map.has('shanhai-pre-sync-backup'));}finally{other.instance.close();}
});
test('a stale cache that was never explicitly edited cannot become an outgoing preference draft',()=>{
  const base={revision:1,initialized:true,source:{id:'macbook'},fields:{theme:'dark'},preferences:{'shanhai-drawing-favorites':'{"tools":["rect"]}'}};
  const stale=client('windows',base);try{
    stale.read().preferences['shanhai-drawing-favorites']='{"tools":[]}';
    stale.instance.backup();assert.equal(stale.map.has('shanhai-settings-draft'),false);
    assert.deepEqual(settingsOperations(base,stale.instance.localState()),[]);
    stale.instance.receive({...structuredClone(base),revision:2});
    assert.equal(stale.read().preferences['shanhai-drawing-favorites'],'{"tools":["rect"]}');
  }finally{stale.instance.close();}
});
test('initial import is performed once and all devices use ordinary edits afterwards',()=>{
  const store=new WorkspaceStore(':memory:');try{
    const base=adopt(store);
    for(const id of ['windows','macbook'])assert.throws(()=>adoptWorkspaceSettings(store,{source:{id},baseRevision:base.revision,fields:seed,preferences:{}},owner),{status:409});
    assert.deepEqual(store.settings(),base);
  }finally{store.close();}
});
test('replaying a saved batch cannot overwrite a newer edit, including after a database reopen',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'chartbridge-sync-replay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'workspace.sqlite');let store=new WorkspaceStore(path);
  const base=adopt(store),batch={baseRevision:base.revision,batchId:'first-edit',operations:[{kind:'field',key:'theme',value:'light',before:'dark'}]};
  const first=patchWorkspaceSettings(store,batch,editor);patch(store,first,'field','theme','dark');
  const latest=store.settings();store.close();store=new WorkspaceStore(path);
  try{
    const replay=patchWorkspaceSettings(store,batch,editor);assert.equal(replay.replayed,true);assert.equal(replay.committedRevision,first.revision);
    assert.equal(replay.revision,latest.revision);assert.equal(store.read().theme,'dark');
    assert.throws(()=>patchWorkspaceSettings(store,{...batch,operations:[{kind:'field',key:'theme',value:'dark'}]},editor),{status:400});
    assert.deepEqual(store.settings(),latest);
  }finally{store.close();}
});
test('a late acknowledgement follows the newer SSE revision without republishing the old edit',async()=>{
  const store=new WorkspaceStore(':memory:'),base=adopt(store),a=client('windows',base);let reply,saved,calls=0;
  a.instance.api=async(path,options)=>{calls++;saved=patchWorkspaceSettings(store,JSON.parse(options.body),editor);return new Promise(resolve=>{reply=resolve;});};
  try{
    a.edit('fields','theme','light');a.edit('preferences','shanhai-drawing-colors','{"color":"#f23645"}');
    const sending=a.instance.flush();
    const latest=patchWorkspaceSettings(store,{baseRevision:saved.revision,operations:[{kind:'field',key:'theme',value:'dark'},{kind:'preference',key:'shanhai-drawing-colors',value:'{"color":"#2962ff"}'}]},editor);
    a.instance.receive(latest);reply(saved);await sending;
    assert.equal(a.read().fields.theme,'dark');assert.equal(a.read().preferences['shanhai-drawing-colors'],'{"color":"#2962ff"}');
    assert.equal(a.instance.pending.size,0);await a.instance.flush();assert.equal(calls,1);
  }finally{a.instance.close();store.close();}
});
test('a fresh edit made during an in-flight save is retained even when it returns to the submitted color',async()=>{
  const store=new WorkspaceStore(':memory:'),base=adopt(store),a=client('windows',base);let reply,saved,calls=0;
  a.instance.api=async(path,options)=>{const next=patchWorkspaceSettings(store,JSON.parse(options.body),editor);calls++;if(calls===1){saved=next;return new Promise(resolve=>{reply=resolve;});}return next;};
  try{
    a.edit('preferences','shanhai-drawing-colors','{"color":"#f23645"}');const sending=a.instance.flush();
    a.edit('preferences','shanhai-drawing-colors','{"color":"#2962ff"}');a.edit('preferences','shanhai-drawing-colors','{"color":"#f23645"}');
    const latest=patch(store,saved,'preference','shanhai-drawing-colors','{"color":"#ffffff"}');a.instance.receive(latest);reply(saved);await sending;
    assert.equal(a.read().preferences['shanhai-drawing-colors'],'{"color":"#f23645"}');
    await a.instance.flush();assert.equal(store.settings().preferences['shanhai-drawing-colors'],'{"color":"#f23645"}');assert.equal(calls,2);
  }finally{a.instance.close();store.close();}
});
test('an uncertain network result retries the same batch and keeps newer server edits',async()=>{
  const store=new WorkspaceStore(':memory:'),base=adopt(store),a=client('macbook',base);let calls=0,firstBatch;
  a.instance.api=async(path,options)=>{const batch=JSON.parse(options.body);calls++;if(calls===1)firstBatch=batch;else assert.deepEqual(batch,firstBatch);const next=patchWorkspaceSettings(store,batch,editor);if(calls===1)throw Error('response lost');return next;};
  try{
    a.edit('preferences','shanhai-drawing-colors','{"color":"#f23645"}');assert.equal(await a.instance.flush(),false);
    const latest=patch(store,store.settings(),'preference','shanhai-drawing-colors','{"color":"#2962ff"}');a.instance.receive(latest);
    assert.equal(await a.instance.flush(),true);assert.equal(a.read().preferences['shanhai-drawing-colors'],'{"color":"#2962ff"}');
    assert.equal(store.settings().revision,latest.revision);assert.equal(a.instance.pending.size,0);
  }finally{a.instance.close();store.close();}
});
