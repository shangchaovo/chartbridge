import test from 'node:test';
import assert from 'node:assert/strict';
import { simplifyStroke, registerFreehandOverlays, MAX_FREEHAND_POINTS } from '../src/freehand.js';
import { drawingPatch } from '../src/drawing-editor.js';
import { chartDateTimeInput, parseChartDateTime } from '../src/chart-time.js';
import { SharedCharts } from '../server/shared-charts.mjs';
const start=Date.parse('2026-10-17T00:00Z');
test('line chart type persists independently from area; unsupported transforms remain rejected',()=>{
  const store=new SharedCharts(':memory:');
  const apply=value=>store.apply('main',{baseRevision:0,batchId:'type',actor:{id:'test'},operations:[{type:'set_field',field:'chartType',value}]},{role:'editor',kind:'human'});
  try{assert.throws(()=>apply('heikin_ashi'),/图表类型/);assert.equal(apply('line').state.chartType,'line');assert.equal(store.get().state.chartType,'line');}finally{store.close();}
});
test('stroke reduction preserves endpoints and corners and caps long strokes',()=>{
  const straight=Array.from({length:100},(_,x)=>({x,y:0,point:{value:x}}));
  const reduced=simplifyStroke(straight);assert.deepEqual(reduced,[straight[0],straight.at(-1)]);
  const corner=[{x:0,y:0},{x:50,y:50},{x:100,y:0}];assert.deepEqual(simplifyStroke(corner),corner);
  const noisy=Array.from({length:2000},(_,x)=>({x,y:100*Math.sin(x)})),bounded=simplifyStroke(noisy);
  assert.ok(bounded.length<=MAX_FREEHAND_POINTS);assert.equal(bounded[0],noisy[0]);assert.equal(bounded.at(-1),noisy.at(-1));
});
test('freehand figures preserve sub-bar offsets and highlighter transparency',()=>{
  const definitions=[];registerFreehandOverlays(d=>definitions.push(d));
  const context={coordinates:[{x:10,y:20},{x:20,y:30}],overlay:{points:[{xOffset:.25},{xOffset:-.25}],styles:{line:{color:'#fbc02d',size:14}}},barSpace:{bar:8}};
  const figure=definitions[1].createPointFigures(context)[0];assert.deepEqual(figure.attrs.coordinates,[{x:12,y:20},{x:18,y:30}]);assert.equal(figure.styles.color,'#fbc02d55');
});
test('long strokes persist with offsets, while ordinary drawings retain the 12-anchor limit',()=>{
  const store=new SharedCharts(':memory:');
  const points=Array.from({length:200},(_,i)=>({timestamp:start+i*1000,value:100+i/10,xOffset:.125}));
  const apply=(drawing,revision,batch)=>store.apply('main',{baseRevision:revision,batchId:batch,actor:{id:'test'},operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing}]},{role:'editor',kind:'human'});
  try{const saved=apply({id:'brush',name:'localBrush',points,zLevel:7},0,'save');assert.deepEqual(saved.state.drawings['BTCUSDT|1d'][0].points,points);assert.equal(saved.state.drawings['BTCUSDT|1d'][0].zLevel,7);
    assert.throws(()=>apply({id:'many',name:'segment',points:points.map(({timestamp,value})=>({timestamp,value}))},1,'reject'),/锚点/);
    assert.throws(()=>apply({id:'bad',name:'localBrush',points:[{timestamp:start,value:10,xOffset:2}]},1,'offset'),/偏移/);
    assert.throws(()=>apply({id:'huge',name:'localBrush',points:Array(257).fill(points[0])},1,'huge'),/锚点/);
  }finally{store.close();}
});
const original={name:'segment',points:[{timestamp:start+123,value:100.123456789123,dataIndex:4},{dataIndex:9,value:112.987654321}],styles:{line:{color:'#2962ff',size:1},text:{size:11}},lock:false};
const values=()=>({color:'#ff0000',width:2,lineStyle:'dashed',textSize:12,lock:false,points:[{price:String(original.points[0].value),time:chartDateTimeInput(original.points[0].timestamp,'Asia/Shanghai')},{price:String(original.points[1].value),index:'9'}]});
test('style-only edits preserve every original anchor and millisecond/price precision',()=>{
  const result=drawingPatch(original,values(),'Asia/Shanghai');assert.deepEqual(result.points,original.points);assert.equal(result.styles.line.color,'#ff0000');assert.equal(result.styles.line.style,'dashed');assert.equal(original.styles.line.size,1);
  const normalized={...original,points:[{timestamp:start,value:1,dataIndex:5}]};const input={...values(),points:[{price:'1',time:'2026-10-17T08:00'}]};assert.deepEqual(drawingPatch(normalized,input,'Asia/Shanghai').points,normalized.points);
});
test('coordinate editor changes time and price atomically, supports index anchors and rejects blank numbers',()=>{
  const input=values();input.points[0]={price:'99.5',time:'2026-10-18T08:00'};input.points[1].index='12';
  const result=drawingPatch(original,input,'Asia/Shanghai');assert.deepEqual(result.points[0],{timestamp:start+86400000,value:99.5});assert.equal(result.points[1].dataIndex,12);
  input.points[0].price='';assert.throws(()=>drawingPatch(original,input,'Asia/Shanghai'),/价格/);
});
test('locked drawings and freehand geometry cannot be changed through anchor fields',()=>{
  const input=values();input.points[0].price='200';
  assert.deepEqual(drawingPatch({...original,lock:true},input,'Asia/Shanghai').points,original.points);
  assert.deepEqual(drawingPatch({...original,name:'localBrush'},input,'Asia/Shanghai').points,original.points);
});
test('local timestamp parsing preserves milliseconds, rejects DST gaps and resolves repeated hours',()=>{
  assert.equal(parseChartDateTime('2026-10-17T08:00:00.123','Asia/Shanghai'),start+123);
  assert.equal(parseChartDateTime('2026-02-30T12:00','UTC'),null);
  assert.equal(parseChartDateTime('2026-03-08T02:30','America/New_York'),null);
  const early=Date.parse('2026-11-01T05:30Z'),late=Date.parse('2026-11-01T06:30Z');
  assert.equal(parseChartDateTime('2026-11-01T01:30','America/New_York'),early);
  assert.equal(parseChartDateTime('2026-11-01T01:30','America/New_York',late),late);
});
