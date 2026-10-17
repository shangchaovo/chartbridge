import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedCharts } from '../server/shared-charts.mjs';
import { chartStateFromWorkspace, diffChartStates, mergeChartStates } from '../src/collab-state.js';
import { ChartCollaboration } from '../src/collaboration.js';
const editor={role:'editor',kind:'agent'};
const batch=(revision,operations,id='batch-1')=>({baseRevision:revision,batchId:id,actor:{id:'agent-1',name:'研究 Agent'},operations});
const note=id=>({type:'upsert_note',note:{id,symbol:'BTCUSDT',interval:'1m',text:'关注成交量',timestamp:1000,price:100}});
test('chart changes are atomic, versioned, idempotent and role checked',()=>{
  const charts=new SharedCharts(':memory:');
  try{
    const first=charts.apply('main',batch(0,[note('n1')]),editor);assert.equal(first.revision,1);assert.equal(first.state.notes.n1.author.kind,'agent');
    const retry=charts.apply('main',batch(0,[note('n1')]),editor);assert.equal(retry.replayed,true);assert.equal(retry.revision,1);
    assert.throws(()=>charts.apply('main',batch(0,[note('n2')],'batch-2'),editor),e=>e.status===409&&e.details.current.revision===1);
    assert.throws(()=>charts.apply('main',batch(1,[note('n2')],'batch-2'),{role:'reader'}),e=>e.status===403);
    assert.throws(()=>charts.apply('main',batch(1,[{type:'set_field',field:'symbol',value:'ETHUSDT'},{type:'set_field',field:'interval',value:'bad'}],'batch-3'),editor));
    assert.equal(charts.get().state.symbol,'BTCUSDT');assert.equal(charts.get().revision,1);assert.equal(charts.history().length,1);
    assert.throws(()=>charts.apply('main',batch(1,[note('different')]),editor),e=>e.status===409);
  }finally{charts.close();}
});
test('merge preserves independent drawings and blocks conflicting edits on the same field',()=>{
  const base=chartStateFromWorkspace(),local=structuredClone(base),remote=structuredClone(base);
  local.drawings['BTCUSDT|1d']=[{id:'human',name:'horizontalStraightLine',points:[{timestamp:1000,value:100}]}];
  remote.drawings['BTCUSDT|1d']=[{id:'agent',name:'horizontalStraightLine',points:[{timestamp:1000,value:110}]}];
  let merged=mergeChartStates(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.state.drawings['BTCUSDT|1d'].length,2);
  local.pineCode='human code';remote.pineCode='agent code';merged=mergeChartStates(base,local,remote);assert.deepEqual(merged.conflicts,['pineCode']);assert.equal(merged.state.pineCode,'human code');
});
test('server authorship metadata does not turn an echoed note into a conflict',()=>{
  const base=chartStateFromWorkspace(),local=structuredClone(base);local.notes.n1=note('n1').note;
  const remote=structuredClone(local);remote.notes.n1.author={name:'Agent'};remote.notes.n1.updatedAt=12345;
  const merged=mergeChartStates(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.deepEqual(diffChartStates(remote,merged.state),[]);assert.equal(merged.state.notes.n1.author.name,'Agent');
});
test('delete vs edit conflicts preserve the local draft',()=>{
  const base=chartStateFromWorkspace();base.notes.n1=note('n1').note;
  const local=structuredClone(base),remote=structuredClone(base);delete local.notes.n1;remote.notes.n1.text='Agent edited';
  const result=mergeChartStates(base,local,remote);assert.deepEqual(result.conflicts,['notes/n1']);assert.equal(result.state.notes.n1,undefined);
});
test('browser client merges a concurrent remote edit before publishing its local change',async()=>{
  const charts=new SharedCharts(':memory:');let state=charts.get().state;const initial=charts.get();
  const client=new ChartCollaboration({api:async(_path,options)=>charts.apply('main',JSON.parse(options.body),editor),capture:()=>state,apply:next=>{state=next;},changed:()=>{},actor:{id:'human',name:'人'}});client.base=initial;
  state.pineCode='human draft';const remote=charts.apply('main',batch(0,[note('n1')]),editor);client.receive(remote);
  await client.flush();assert.equal(charts.get().revision,2);assert.equal(charts.get().state.pineCode,'human draft');assert.ok(charts.get().state.notes.n1);assert.equal(client.conflicts.length,0);
  client.close();charts.close();
});
test('client conflict blocks publication until explicitly resolved',async()=>{
  const charts=new SharedCharts(':memory:');let state=charts.get().state;const client=new ChartCollaboration({api:async(_path,options)=>charts.apply('main',JSON.parse(options.body),editor),capture:()=>state,apply:next=>{state=next;},changed:()=>{},actor:{id:'human',name:'人'}});client.base=charts.get();
  state.pineCode='human draft';client.receive(charts.apply('main',batch(0,[{type:'set_field',field:'pineCode',value:'agent draft'}]),editor));
  await client.flush();assert.equal(charts.get().revision,1);assert.equal(state.pineCode,'human draft');assert.deepEqual(client.conflicts,['pineCode']);
  client.resolve('local');await client.flush();assert.equal(charts.get().state.pineCode,'human draft');client.close();charts.close();
});

test('remote conflict resolution keeps other independent local edits',()=>{
  const base=chartStateFromWorkspace();let state=structuredClone(base),remote=structuredClone(base);state.pineCode='local';state.notes.local=note('local').note;remote.pineCode='remote';
  const client=new ChartCollaboration({capture:()=>state,apply:next=>{state=next;},changed:()=>{},actor:{id:'human',name:'人'}});client.base={revision:0,state:base};client.receive({revision:1,state:remote});client.resolve('remote');
  assert.equal(state.pineCode,'remote');assert.ok(state.notes.local);client.close();
});
test('initial server snapshot is isolated from browser draft mutation',()=>{
  const OldEventSource=globalThis.EventSource;globalThis.EventSource=class{addEventListener(){}close(){}};
  try{
    const snapshot={revision:0,state:chartStateFromWorkspace()},state=snapshot.state,client=new ChartCollaboration({capture:()=>state,apply:()=>{},changed:()=>{},actor:{id:'human',name:'人'}});client.start(snapshot);state.notes.local=note('local').note;
    assert.equal(client.base.state.notes.local,undefined);assert.equal(diffChartStates(client.base.state,state).length,1);client.close();
  }finally{if(OldEventSource===undefined)delete globalThis.EventSource;else globalThis.EventSource=OldEventSource;}
});
