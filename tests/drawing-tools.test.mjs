import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingHistory } from '../src/drawing-history.js';
import { rangeMeasurement, registerChartOverlays } from '../src/chart-overlays.js';
import { DRAWING_TOOLS, SAVED_DRAWING_TYPES } from '../src/drawing-catalog.js';
import { SharedCharts } from '../server/shared-charts.mjs';
import { CURVE_POINTS } from '../src/curve-drawing.js';

const drawing=(id='d1',value=100)=>({id,name:'segment',points:[{timestamp:1000,value},{timestamp:2000,value:value+10}],lock:false,visible:true});
test('drawing history supports edit/delete/undo/redo per chart and truncates a changed future',()=>{
  const h=new DrawingHistory();h.reset('A|1d',[]);h.record('A|1d',[drawing()]);h.record('A|1d',[drawing('d1',110)]);
  assert.equal(h.undo('A|1d')[0].points[0].value,100);
  assert.deepEqual(h.undo('A|1d'),[]);assert.equal(h.undo('A|1d'),null);
  assert.equal(h.redo('A|1d')[0].points[0].value,100);
  h.record('A|1d',[drawing('d2')]);assert.equal(h.canRedo('A|1d'),false);
  h.reset('B|1d',[]);assert.equal(h.canUndo('B|1d'),false);assert.equal(h.canUndo('A|1d'),true);
});
test('collaboration echoes retain undo history; other edits reset it instead of overwriting shared drawings',()=>{
  const h=new DrawingHistory();h.reset('A',[]);h.record('A',[drawing()]);
  h.observe('A',[{...drawing(),author:{name:'Agent'},updatedAt:123}]);assert.equal(h.canUndo('A'),true);
  h.observe('A',[drawing('d1',120)]);assert.equal(h.canUndo('A'),false);assert.equal(h.undo('A'),null);
  const result=h.entries.get('A').snapshots[0];result[0].points[0].value=121;
  h.record('A',[drawing('d1',125)]);const copy=h.undo('A');copy[0].points[0].value=999;
  assert.equal(h.redo('A')[0].points[0].value,125);
});
test('measurement uses signed price change, actual timestamps and available bar indices',()=>{
  assert.deepEqual(rangeMeasurement([{value:100,timestamp:1000,dataIndex:3},{value:90,timestamp:61000,dataIndex:8}]),{change:-10,percent:-10,bars:5,elapsed:60000});
  assert.equal(rangeMeasurement([{value:0},{value:2}]).percent,null);
  assert.equal(rangeMeasurement([{value:1}]),null);
  assert.equal(rangeMeasurement([{value:1},{value:NaN}]),null);
});
test('every custom and toolbar drawing type is accepted by shared persistence including text and visibility',()=>{
  const custom=[];registerChartOverlays(item=>custom.push(item));
  const chart=new SharedCharts(':memory:');let revision=0;
  try{
    for(const name of new Set([...DRAWING_TOOLS.map(tool=>tool.name),...custom.map(item=>item.name),'localNote'])){
      assert.ok(SAVED_DRAWING_TYPES.includes(name));
      const value={...drawing(name),name,visible:false,...(name==='localNote'?{extendData:'中文标注'}:{}),...(['longPosition','shortPosition'].includes(name)?{points:[{timestamp:1000,value:100},{timestamp:2000,value:name==='longPosition'?95:105},{timestamp:3000,value:name==='longPosition'?110:90}]}:{}),...(CURVE_POINTS[name]?{points:Array.from({length:CURVE_POINTS[name]},(_,index)=>({timestamp:1000*(index+1),value:100+index}))}:{})};
      const saved=chart.apply('main',{baseRevision:revision,batchId:`batch-${name}`,actor:{id:'user',name:'Tester'},operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing:value}]},{role:'editor',kind:'human'});
      revision=saved.revision;
      assert.equal(saved.state.drawings['BTCUSDT|1d'].find(item=>item.id===name).visible,false);
    }
  }finally{chart.close();}
});
