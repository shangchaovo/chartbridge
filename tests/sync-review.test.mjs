import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartCollaboration} from '../src/collaboration.js';
import {WorkspaceSync} from '../src/workspace-sync.js';
import {SharedCharts} from '../server/shared-charts.mjs';
import {WorkspaceStore} from '../server/workspace-store.mjs';

const principal={role:'editor',kind:'human'},actor={id:'review',name:'Review'};
const turns=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const drawing=value=>({id:'rect',name:'rect',points:[{dataIndex:10,value},{dataIndex:20,value:value-5}],lock:false});
function settingsClient(api){
 let state={revision:1,initialized:true,source:{id:'device'},fields:{theme:'dark'},preferences:{}};
 const client=new WorkspaceSync({api,capture:()=>structuredClone(state),apply:next=>{state=next;},actor});client.base=structuredClone(state);client.observed=structuredClone(state);
 return {client,edit:()=>{state.fields.theme='light';client.schedule();}};
}
test('failed settings requests retain the exact batch and wait before retrying',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;const bodies=[];
 const {client,edit}=settingsClient(async(_path,options)=>{calls++;bodies.push(options.body);throw Error('offline');});
 try{edit();await client.flush();assert.equal(calls,1);t.mock.timers.tick(1);await turns();assert.equal(calls,1,'failed batch must not retry at 0ms');t.mock.timers.tick(client.retryMs);await turns();assert.equal(calls,2);assert.equal(bodies[0],bodies[1]);}finally{client.close();}
});
test('a known 409 rebuilds the settings batch against the new revision',async()=>{
 const bodies=[];const {client,edit}=settingsClient(async(_path,options)=>{const body=JSON.parse(options.body);bodies.push(body);if(bodies.length===1)throw Object.assign(Error('changed'),{status:409,details:{current:{revision:2,initialized:true,source:{id:'device'},fields:{theme:'dark'},preferences:{}}}});return {revision:3,initialized:true,source:{id:'device'},fields:{theme:'light'},preferences:{}};});
 try{edit();await client.flush();await client.flush();assert.equal(bodies[1].baseRevision,2);assert.notEqual(bodies[1].batchId,bodies[0].batchId);}finally{client.close();}
});
test('editing the same drawing during an in-flight save does not conflict with its own acknowledgement',async()=>{
 const charts=new SharedCharts(':memory:');let state=charts.get().state,reply,saved,calls=0;state.drawings['BTCUSDT|1d']=[drawing(100)];charts.apply('main',{baseRevision:0,batchId:'seed',actor,operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing:drawing(100)}]},principal);
 const client=new ChartCollaboration({api:async(_path,options)=>{calls++;const next=charts.apply('main',JSON.parse(options.body),principal);if(calls===1){saved=next;return new Promise(resolve=>{reply=resolve;});}return next;},capture:()=>structuredClone(state),apply:next=>{state=next;},changed:()=>{},actor});client.base=charts.get();
 try{state.drawings['BTCUSDT|1d']=[drawing(110)];const sending=client.flush();state.drawings['BTCUSDT|1d']=[drawing(120)];client.schedule();reply(saved);await sending;assert.deepEqual(client.conflicts,[]);assert.equal(state.drawings['BTCUSDT|1d'][0].points[0].value,120);await client.flush();assert.equal(charts.get().state.drawings['BTCUSDT|1d'][0].points[0].value,120);}finally{client.close();charts.close();}
});
test('closing a chart client while a failed save is pending prevents subsequent retries',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0,reject;const charts=new SharedCharts(':memory:');const state=charts.get().state;state.pineCode='local draft';
 const client=new ChartCollaboration({api:()=>{calls++;return new Promise((_resolve,fail)=>{reject=fail;});},capture:()=>state,apply(){},changed(){},actor});client.base=charts.get();
 try{const sending=client.flush();client.close();reject(Error('offline'));await sending;t.mock.timers.tick(5000);await turns();assert.equal(calls,1);}finally{client.close();charts.close();}
});
test('legacy workspace saves cannot replace the versioned chart, and workspace reads project the latest chart',()=>{
 const store=new WorkspaceStore(':memory:'),charts=new SharedCharts(':memory:');store.write({watchlist:['AAPL'],drawings:{'BTCUSDT|1d':[drawing(100)]}});
 try{store.setChartSource(()=>charts.get().state);const current=charts.get();charts.apply('main',{baseRevision:current.revision,batchId:'updated-drawing',actor,operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing:drawing(120)}]},principal);const stale={watchlist:['MSFT'],drawings:{'BTCUSDT|1d':[drawing(80)]}};store.write(stale);assert.equal(store.read().drawings['BTCUSDT|1d'][0].points[0].value,120);assert.deepEqual(store.read().watchlist,['MSFT']);assert.equal(stale.drawings['BTCUSDT|1d'][0].points[0].value,80);}finally{store.close();charts.close();}
});

test('an own SSE echo arriving before the HTTP reply retains the next edit to the same drawing',async()=>{
 const charts=new SharedCharts(':memory:');let state=charts.get().state,reply,saved;
 const client=new ChartCollaboration({api:async(_path,options)=>{saved=charts.apply('main',JSON.parse(options.body),principal);return new Promise(resolve=>{reply=resolve;});},capture:()=>structuredClone(state),apply:next=>{state=next;},changed(){},actor});client.base=charts.get();
 try{state.drawings['BTCUSDT|1d']=[drawing(110)];const sending=client.flush();state.drawings['BTCUSDT|1d']=[drawing(120)];client.receive(saved);assert.deepEqual(client.conflicts,[]);assert.equal(state.drawings['BTCUSDT|1d'][0].points[0].value,120);reply(saved);await sending;assert.equal(state.drawings['BTCUSDT|1d'][0].points[0].value,120);}finally{client.close();charts.close();}
});

test('own acknowledgements only rebase submitted operations when more than 100 edits are queued',async()=>{
 const charts=new SharedCharts(':memory:');let state=charts.get().state,calls=0;
 const client=new ChartCollaboration({api:async(_path,options)=>{calls++;return charts.apply('main',JSON.parse(options.body),principal);},capture:()=>structuredClone(state),apply:next=>{state=next;},changed(){},actor});client.base=charts.get();
 try{for(let i=0;i<130;i++)state.notes['n'+i]={id:'n'+i,symbol:'BTCUSDT',interval:'1d',text:'note '+i};await client.flush();assert.equal(Object.keys(state.notes).length,130);await client.flush();assert.equal(Object.keys(charts.get().state.notes).length,130);assert.deepEqual(client.conflicts,[]);assert.equal(calls,2);}finally{client.close();charts.close();}
});

test('settings SSE activity and fresh edits do not shorten the failed batch retry delay',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;const {client,edit}=settingsClient(async()=>{calls++;throw Error('offline');});
 try{edit();await client.flush();client.receive({revision:2,initialized:true,source:{id:'device'},fields:{theme:'dark',dual:true},preferences:{}});client.schedule();t.mock.timers.tick(client.retryMs-1);await turns();assert.equal(calls,1);t.mock.timers.tick(1);await turns();assert.equal(calls,2);}finally{client.close();}
});
