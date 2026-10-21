import test from 'node:test';
import assert from 'node:assert/strict';
import {RECTANGLE_HANDLES,rectangleCursor,rectangleHandleCoordinates,moveRectanglePoints,registerRectangleOverlay} from '../src/rectangle-overlays.js';
const start=()=>[{dataIndex:10,timestamp:1000,value:110},{dataIndex:30,timestamp:3000,value:90}];
test('rectangle exposes four corners, four edge midpoints and a center move point',()=>{
 const handles=rectangleHandleCoordinates([{x:300,y:250},{x:100,y:50}]);
 assert.equal(Object.keys(handles).length,9);assert.deepEqual(handles.nw,{x:100,y:50});assert.deepEqual(handles.e,{x:300,y:150});assert.deepEqual(handles.center,{x:200,y:150});
 assert.equal(rectangleCursor('rectangle-nw'),'nwse-resize');assert.equal(rectangleCursor('rectangle-ne'),'nesw-resize');assert.equal(rectangleCursor('rectangle-e'),'ew-resize');assert.equal(rectangleCursor('rectangle-n'),'ns-resize');
});
test('every rectangle side and corner changes only the axes belonging to that handle',()=>{
 for(const key of RECTANGLE_HANDLES.filter(k=>k!=='center')){
  const before=start(),after=moveRectanglePoints(before,'rectangle-'+key,{dataIndex:20,value:100});
  assert.equal(after[0].dataIndex,key.includes('w')?20:10,key);assert.equal(after[1].dataIndex,key.includes('e')?20:30,key);
  assert.equal(after[0].value,key.includes('n')?100:110,key);assert.equal(after[1].value,key.includes('s')?100:90,key);
  assert.equal(after[0].timestamp,key.includes('w')?undefined:1000,key);assert.equal(after[1].timestamp,key.includes('e')?undefined:3000,key);
  assert.deepEqual(before,start());
 }
});
test('rectangle resize handles work with reversed stored anchors and inverted price axes',()=>{
 const reversed=start().reverse();const north=moveRectanglePoints(reversed,'rectangle-n',{dataIndex:20,value:120});assert.deepEqual(north.map(p=>p.value),[90,120]);
 const inverted=moveRectanglePoints(start(),'rectangle-nw',{dataIndex:8,value:80},null,{reverse:true});assert.equal(inverted[0].dataIndex,8);assert.equal(inverted[1].value,80);assert.equal(inverted[0].value,110);
 const crossed=moveRectanglePoints(start(),'rectangle-nw',{dataIndex:40,value:70});assert.equal(crossed[0].dataIndex,40);assert.equal(crossed[0].value,70);
 const again=moveRectanglePoints(crossed,'rectangle-se',{dataIndex:45,value:60});assert.equal(again[0].dataIndex,45);assert.equal(again[0].value,60);assert.deepEqual(again[1],crossed[1]);
});
test('center and background translation retain width and price height, including future bar indices',()=>{
 for(const key of ['rectangle-center','rectangle-body']){
  const before=start();before[1]={dataIndex:900,value:90};const after=moveRectanglePoints(before,key,{dataIndex:22,value:106},{dataIndex:20,value:100});
  assert.deepEqual(after.map(p=>p.dataIndex),[12,902]);assert.deepEqual(after.map(p=>p.value),[116,96]);assert.ok(after.every(p=>p.timestamp===undefined));
 }
});
test('rectangle renders nine separate hit targets, keeps legacy storage and honors explicit locks',()=>{
 let template;registerRectangleOverlay(item=>template=item,{selected:()=> 'rect'});
 const overlay={id:'rect',points:start(),isDrawing:()=>false},args={overlay,coordinates:[{x:10,y:20},{x:200,y:120}]};
 const figures=template.createPointFigures(args);assert.equal(template.totalStep,3);assert.equal(template.needDefaultPointFigure,false);
 for(const key of RECTANGLE_HANDLES)assert.equal(figures.filter(f=>f.key==='rectangle-'+key).length,1,key);
 overlay.lock=true;assert.equal(template.createPointFigures(args).length,1);assert.deepEqual(overlay.points,start());
});
