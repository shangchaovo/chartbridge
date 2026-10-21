import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {drawingSelectionCallbacks} from '../src/drawing-selection.js';

// Exercise the installed engine's real event ordering, including onClick before
// _clickInstanceInfo is committed. No copy of the engine or ordering mock.
const source=await readFile(new URL('../node_modules/klinecharts/dist/index.esm.js',import.meta.url),'utf8');
const {OverlayStore}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {OverlayStore};').toString('base64'));
test('native position clicks and programmatic selection never reenter selection writes',()=>{
 const store=new OverlayStore({getChart:()=>({updatePane(){}})});
 let selected='',writes=0;
 const info=instance=>({paneId:'candle_pane',instance,figureType:instance?2:0,figureKey:'position-body',figureIndex:0,attrsIndex:0});
 function show(overlay,syncCanvas=true){
  if(syncCanvas&&store.getClickInstanceInfo().instance?.id!==overlay.id){writes++;assert.ok(writes<5,'selection recursively wrote back');store.setClickInstanceInfo(info(overlay),{});}
  selected=overlay.id;
 }
 const callbacks=drawingSelectionCallbacks(show,id=>{if(id===selected)selected='';});
 const long={id:'long',groupId:'user-drawings',name:'longPosition',isDrawing:()=>false,...callbacks};
 const short={...long,id:'short',name:'shortPosition'};
 store.setClickInstanceInfo(info(long),{});assert.equal(selected,'long');assert.equal(writes,0);assert.equal(store.getClickInstanceInfo().instance,long);
 store.setClickInstanceInfo(info(short),{});assert.equal(selected,'short');assert.equal(writes,0);
 store.setClickInstanceInfo(info(null),{});assert.equal(selected,'');
 show(long);assert.equal(selected,'long');assert.equal(writes,1);assert.equal(store.getClickInstanceInfo().instance,long);
 store.setClickInstanceInfo(info(null),{});assert.equal(selected,'');
});
test('preview clicks and overlays outside the user drawing group do not select the toolbar',()=>{
 const shown=[],callbacks=drawingSelectionCallbacks((overlay,sync)=>shown.push([overlay.id,sync]),()=>{});
 callbacks.onClick({overlay:{id:'preview',groupId:'user-drawings',isDrawing:()=>true}});
 callbacks.onClick({overlay:{id:'study',groupId:'computed'}});callbacks.onSelected({overlay:{id:'study',groupId:'computed'}});
 assert.deepEqual(shown,[]);
});
