// Two persisted opposite corners produce eight resize handles and a move handle.
// Side ownership is resolved at drag start, so reversed/crossed anchors work too.
export const RECTANGLE_HANDLES=Object.freeze(['nw','n','ne','w','center','e','sw','s','se']);
export const rectangleCursor=key=>({n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',center:'move',body:'grab'})[String(key).replace('rectangle-','')]||'grab';
export function rectangleHandleCoordinates(coordinates){
 const [a,b]=coordinates,x=Math.min(a.x,b.x),right=Math.max(a.x,b.x),y=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y),cx=(x+right)/2,cy=(y+bottom)/2;
 return {nw:{x,y},n:{x:cx,y},ne:{x:right,y},w:{x,y:cy},center:{x:cx,y:cy},e:{x:right,y:cy},sw:{x,y:bottom},s:{x:cx,y:bottom},se:{x:right,y:bottom}};
}
function setIndex(point,index){if(Number.isFinite(index)&&index!==point.dataIndex){point.dataIndex=Math.round(index);delete point.timestamp;}}
export function moveRectanglePoints(start,key,point,origin,{reverse=false}={}){
 const points=start.map(p=>({...p}));if(points.length!==2||!Number.isFinite(point?.value))return points;
 const handle=String(key).replace('rectangle-',''),left=start[0].dataIndex<=start[1].dataIndex?0:1,right=1-left;
 const top=(reverse?start[0].value<=start[1].value:start[0].value>=start[1].value)?0:1,bottom=1-top;
 if(handle==='body'||handle==='center'){
  if(!Number.isFinite(origin?.value))return points;
  const bars=Number.isFinite(point.dataIndex)&&Number.isFinite(origin.dataIndex)?Math.round(point.dataIndex-origin.dataIndex):0,delta=point.value-origin.value;
  for(let i=0;i<2;i++){points[i].value=start[i].value+delta;if(bars)setIndex(points[i],start[i].dataIndex+bars);}
 }else if(RECTANGLE_HANDLES.includes(handle)){
  if(handle.includes('w'))setIndex(points[left],point.dataIndex);
  if(handle.includes('e'))setIndex(points[right],point.dataIndex);
  if(handle.includes('n'))points[top].value=point.value;
  if(handle.includes('s'))points[bottom].value=point.value;
 }
 return points;
}
export function registerRectangleOverlay(register,context={}){
 const drags=new WeakMap();
 register({name:'rect',totalStep:3,needDefaultPointFigure:false,needDefaultXAxisFigure:false,needDefaultYAxisFigure:false,
  onPressedMoveStart:({overlay,figureKey,...event})=>{
   context.select?.(overlay);if(overlay.lock)return false;
   const points=context.resolvePoints?.(overlay.points)||overlay.points.map(p=>({...p}));
   drags.set(overlay,{points,key:figureKey,origin:context.point?.(event),reverse:context.reverse?.()||false});context.cursor?.(rectangleCursor(figureKey));return false;
  },
  onPressedMoving:({overlay,...event})=>{
   const drag=drags.get(overlay),point=context.point?.(event);if(!drag||!point)return true;
   context.updatePoints?.(overlay.id,moveRectanglePoints(drag.points,drag.key,point,drag.origin,drag));return true;
  },
  createPointFigures:({coordinates,overlay})=>{
   if(coordinates.length<2)return [];
   const handles=rectangleHandleCoordinates(coordinates),{nw,se}=handles,color=overlay.styles?.line?.color||'#2962ff';
   const figures=[{key:'rectangle-body',type:'rect',attrs:{x:nw.x,y:nw.y,width:se.x-nw.x,height:se.y-nw.y},styles:{style:'stroke_fill',borderColor:color,borderSize:overlay.styles?.line?.size||1,borderStyle:overlay.styles?.line?.style||'solid',color:overlay.styles?.rect?.color||`${color}1f`}}];
   if(!overlay.lock&&(context.selected?.()===overlay.id||context.hovered?.()===overlay.id||overlay.isDrawing?.())){
    // Draw corners after side handles, so very small boxes still expose corners.
    for(const key of ['center','n','s','w','e','nw','ne','sw','se']){const p=handles[key];figures.push(
     {key:'rectangle-'+key,type:'rect',attrs:{x:p.x-9,y:p.y-9,width:18,height:18},styles:{style:'fill',color:'transparent'}},
     {type:'rect',attrs:{x:p.x-3.5,y:p.y-3.5,width:7,height:7},styles:{style:'stroke_fill',color:'#ffffff',borderColor:'#2962ff',borderSize:1.5},ignoreEvent:true});}
   }
   return figures;
  },
 });
}
