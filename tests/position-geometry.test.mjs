import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialPositionPoints,movePositionPoints,POSITION_HANDLES as H} from '../src/position-geometry.js';
import {positionSettings,calculatePosition} from '../src/position-risk.js';
import {registerPositionOverlays} from '../src/position-overlays.js';
const points=()=>[{timestamp:1000,dataIndex:10,value:100},{timestamp:1000,dataIndex:10,value:95},{timestamp:3000,dataIndex:20,value:110}];

test('one-click plans create complete symmetric prices with a separately chosen width',()=>{
 for(const direction of ['long','short']){const p=initialPositionPoints({value:100.004,dataIndex:10,timestamp:1000},direction,{tick:.01,distance:5,end:{dataIndex:30,timestamp:5000}});assert.equal(p.length,3);assert.equal(p[0].value,100);assert.equal(p[2].dataIndex,30);assert.equal(calculatePosition({direction,entry:p[0].value,stop:p[1].value,target:p[2].value}).grossRatio,1);}
});
test('vertical target and stop handles never change duration, and width never changes prices',()=>{
 const p=points(),mouse={dataIndex:99,timestamp:9999,value:112.006};
 const moved=movePositionPoints(p,H.target,mouse,null,{tick:.01});assert.equal(moved[2].value,112.01);assert.equal(moved[2].dataIndex,20);assert.equal(moved[2].timestamp,3000);assert.deepEqual(moved.slice(0,2),p.slice(0,2));
 const width=movePositionPoints(p,H.width,mouse,null);assert.deepEqual(width.map(x=>x.value),[100,95,110]);assert.equal(width[2].dataIndex,99);
 const stop=movePositionPoints(p,H.stop,{...mouse,value:97},null);assert.deepEqual(stop.map(x=>x.value),[100,97,110]);assert.equal(stop[2].dataIndex,20);
});
test('entry handle keeps stop and target prices fixed and cannot cross them',()=>{
 const moved=movePositionPoints(points(),H.entry,{dataIndex:12,timestamp:1200,value:101},null);assert.deepEqual(moved.map(x=>x.value),[101,95,110]);assert.equal(moved[0].dataIndex,12);assert.equal(moved[1].dataIndex,12);assert.equal(moved[2].dataIndex,20);
 const clamped=movePositionPoints(points(),H.entry,{value:9999},null,{tick:.01});assert.equal(clamped[0].value,109.99);
});
test('body translation preserves distances and cannot move a plan below zero',()=>{
 const moved=movePositionPoints(points(),H.body,{dataIndex:14,value:106},{dataIndex:12,value:103},{tick:.01});assert.deepEqual(moved.map(x=>x.value),[103,98,113]);assert.deepEqual(moved.map(x=>x.dataIndex),[12,12,22]);assert.equal(moved[2].value-moved[0].value,10);
 const floor=movePositionPoints(points(),H.body,{value:-1000},{value:100},{tick:.01});assert.ok(floor.every(x=>x.value>0));assert.ok(Math.abs(floor[0].value-floor[1].value-5)<1e-8);
});
test('position overlays use four independent handles and selection-only statistics by default',()=>{
 const all=new Map();let selected='';registerPositionOverlays(o=>all.set(o.name,o),{selected:()=>selected,mark:()=>103});
 const template=all.get('longPosition');assert.equal(template.totalStep,2);assert.equal(template.needDefaultPointFigure,false);
 const existing=points();template.performEventMoveForDrawing.call({isDrawing:()=>false},{points:existing});assert.deepEqual(existing,points(),'restoring or overriding points must not recreate default prices');
 const overlay={id:'p',points:points(),extendData:{},isDrawing:()=>false};const args={overlay,coordinates:[{x:100,y:100},{x:100,y:150},{x:300,y:0}],bounding:{width:800,height:400},yAxis:{convertToPixel:v=>300-v*2}};
 assert.equal(template.createPointFigures(args).filter(f=>f.type==='text').length,0);selected='p';const figures=template.createPointFigures(args);for(const key of [H.target,H.stop,H.entry,H.width])assert.ok(figures.some(f=>f.key===key));assert.ok(figures.some(f=>f.type==='text'&&f.attrs.text.includes('风险/回报比')));
 overlay.extendData={alwaysShowStats:true};selected='';assert.ok(template.createPointFigures(args).some(f=>f.type==='text'));
 overlay.extendData={priceLabels:false};assert.deepEqual(template.createYAxisFigures(args),[]);
});
test('legacy settings acquire display defaults while malformed style values are rejected',()=>{
 const old=positionSettings({accountSize:1234});assert.equal(old.alwaysShowStats,false);assert.equal(old.targetColor,'#089981');assert.equal(old.accountSize,1234);
 assert.equal(positionSettings({lotSize:1e-8}).quantityPrecision,8,'old fractional-lot plans keep sufficient quantity precision');
 for(const bad of [{targetColor:'url(x)'},{alwaysShowStats:'true'},{quantityPrecision:13},{fillOpacity:101},{fontSize:12.5}])assert.throws(()=>positionSettings(bad));
});
