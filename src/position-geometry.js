import {constrainPositionPoints} from './position-risk.js';

export const POSITION_HANDLES={target:'position-target',stop:'position-stop',entry:'position-entry',width:'position-width',body:'position-body'};
export const positionCursor=key=>key===POSITION_HANDLES.width?'ew-resize':[POSITION_HANDLES.target,POSITION_HANDLES.stop].includes(key)?'ns-resize':key===POSITION_HANDLES.entry?'move':'grab';
const round=(value,tick)=>Number((Math.round(value/tick)*tick).toPrecision(14));
const timePoint=point=>({...Number.isFinite(point.timestamp)?{timestamp:point.timestamp}:{},...Number.isFinite(point.dataIndex)?{dataIndex:Math.round(point.dataIndex)}:{}});

// Three persisted semantic anchors remain compatible with plans created previously.
// Creation is a single click; stop and target initially have equal price distances.
export function initialPositionPoints(point,direction,{tick=.01,distance=point.value*.01,end=point}={}){
 const entry=Math.max(tick,round(point.value,tick)),d=direction==='long'?1:-1;
 const gap=Math.max(tick,Math.min(Math.abs(distance),entry*.45));
 const points=[{...timePoint(point),value:entry},{...timePoint(point),value:round(entry-d*gap,tick)},{...timePoint(end),value:round(entry+d*gap,tick)}];
 constrainPositionPoints(points,direction,tick);return points;
}

export function movePositionPoints(start,key,point,origin,{direction='long',tick=.01}={}){
 const points=start.map(p=>({...p}));if(points.length!==3||!Number.isFinite(point?.value))return points;
 if(key===POSITION_HANDLES.target||key===POSITION_HANDLES.stop){
  // Vertical handles cannot alter time or accidentally resize the box.
  points[key===POSITION_HANDLES.stop?1:2].value=Math.max(tick,round(point.value,tick));
 }else if(key===POSITION_HANDLES.width){
  // The right handle changes duration only, even when the pointer also moves vertically.
  if(Number.isFinite(point.dataIndex)&&point.dataIndex>points[0].dataIndex){delete points[2].timestamp;Object.assign(points[2],timePoint(point));}
 }else if(key===POSITION_HANDLES.entry){
  const low=Math.min(points[1].value,points[2].value)+tick,high=Math.max(points[1].value,points[2].value)-tick;
  if(low<=high)points[0].value=Math.max(low,Math.min(high,round(point.value,tick)));
  if(Number.isFinite(point.dataIndex)&&point.dataIndex<points[2].dataIndex){for(const i of [0,1]){delete points[i].timestamp;Object.assign(points[i],timePoint(point));}}
 }else if(origin&&Number.isFinite(origin.value)){
  // Whole-object translation preserves the target and stop distances.
  const delta=Math.max(tick-Math.min(...start.map(p=>p.value)),round(point.value-origin.value,tick));
  const bars=Number.isFinite(point.dataIndex)&&Number.isFinite(origin.dataIndex)?Math.round(point.dataIndex-origin.dataIndex):0;
  for(let i=0;i<3;i++){points[i].value=Number((start[i].value+delta).toPrecision(14));if(bars&&Number.isFinite(start[i].dataIndex)){points[i].dataIndex=start[i].dataIndex+bars;delete points[i].timestamp;}}
 }
 constrainPositionPoints(points,direction,tick);
 points[1]={...points[0],value:points[1].value};
 return points;
}
