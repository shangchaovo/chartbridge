import {calculatePosition,positionSettings} from './position-risk.js';
import {initialPositionPoints,movePositionPoints,POSITION_HANDLES,positionCursor} from './position-geometry.js';
const number=(value,digits=2)=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits}):'—';
const textWidth=(value,size)=>[...value].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?size:size*.58),0);
function pill(center,y,lines,color,settings,bounding,where='top'){
 const size=settings.fontSize,lineHeight=size+4,height=lines.length*lineHeight+6;
 const width=Math.min(bounding.width-8,Math.max(...lines.map(line=>textWidth(line,size)))+12);
 const x=Math.max(4,Math.min(center-width/2,bounding.width-width-4));
 const top=Math.max(2,Math.min(where==='bottom'?y-height:y,bounding.height-height-2));
 return [{key:POSITION_HANDLES.body,type:'rect',attrs:{x,y:top,width,height,radius:3},styles:{style:'fill',color}},...lines.map((line,i)=>({type:'text',attrs:{x:x+width/2,y:top+3+i*lineHeight,text:line,align:'center',baseline:'top'},styles:{size,color:settings.textColor,family:'Arial',backgroundColor:'transparent',borderColor:'transparent',borderSize:0,paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0},ignoreEvent:true}))];
}
export function registerPositionOverlays(register,context={}){
 const drags=new WeakMap();
 for(const [name,direction]of [['longPosition','long'],['shortPosition','short']])register({
  name,totalStep:2,needDefaultPointFigure:false,needDefaultXAxisFigure:false,needDefaultYAxisFigure:false,
  performEventMoveForDrawing({points}){
   // KLineCharts also calls this hook from setPoints on restore/override.
   // Recreate default prices only during initial mouse placement.
   if(!this.isDrawing?.()||!points[0])return;const s=positionSettings(this.extendData||{});
   const geometry=context.initialGeometry?.(points[0],direction,s)||{};
   const initial=initialPositionPoints(points[0],direction,{tick:s.tickSize,...geometry});points.splice(0,points.length,...initial);
  },
  onPressedMoveStart:({overlay,figureKey,...event})=>{
   context.select?.(overlay);
   if(overlay.lock)return false;
   const points=context.resolvePoints?.(overlay.points)||overlay.points.map(p=>({...p}));
   drags.set(overlay,{points,key:figureKey,origin:context.point?.(event)});context.cursor?.(positionCursor(figureKey));return false;
  },
  onPressedMoving:({overlay,...event})=>{
   const drag=drags.get(overlay),point=context.point?.(event);if(!drag||!point)return true;
   const s=positionSettings(overlay.extendData||{}),points=movePositionPoints(drag.points,drag.key,point,drag.origin,{direction,tick:s.tickSize});
   context.updatePoints?.(overlay.id,points);return true;
  },
  createPointFigures:({coordinates,overlay,yAxis,bounding})=>{
   if(coordinates.length<3)return [];const s=positionSettings(overlay.extendData||{});
   const [entry,stop,target]=overlay.points.map(p=>p.value);let r;
   try{r=calculatePosition({direction,entry,stop,target,settings:s,mark:context.mark?.()});}catch{return [];}
   const x=Math.min(coordinates[0].x,coordinates[2].x),right=Math.max(coordinates[0].x,coordinates[2].x),width=Math.max(12,right-x),center=x+width/2;
   const ey=yAxis.convertToPixel(entry),sy=yAxis.convertToPixel(stop),ty=yAxis.convertToPixel(target);
   const selected=context.selected?.()===overlay.id,drawing=overlay.isDrawing?.(),hovered=context.hovered?.()===overlay.id,active=selected||drawing||hovered;
   const alpha=Math.round(s.fillOpacity/100*255).toString(16).padStart(2,'0');
   const figures=[{key:POSITION_HANDLES.body,type:'rect',attrs:{x,y:Math.min(ey,ty),width,height:Math.abs(ty-ey)},styles:{style:'stroke_fill',color:s.targetColor+alpha,borderColor:s.targetColor,borderSize:s.lineWidth}},
    {key:POSITION_HANDLES.body,type:'rect',attrs:{x,y:Math.min(ey,sy),width,height:Math.abs(sy-ey)},styles:{style:'stroke_fill',color:s.stopColor+alpha,borderColor:s.stopColor,borderSize:s.lineWidth}},
    {key:POSITION_HANDLES.body,type:'line',attrs:{coordinates:[{x,y:ey},{x:right,y:ey}]},styles:{color:s.lineColor,size:s.lineWidth,style:'solid'}}];
   if(s.showStats&&(s.alwaysShowStats||active)){
    const compact=s.compact||bounding.width<500,precision=context.precision?.()??2;
    const edge=(label,price,percent,ticks,amount)=>label+': '+number(Math.abs(price-entry),precision)+(s.showPercent?' ('+number(percent,2)+'%)':'')+(!compact&&s.showTicks?' '+number(ticks,2):'')+(!compact&&s.showAmount?', 金额: '+number(amount,2):'');
    const targetText=edge('目标',target,r.targetPercent,r.targetTicks,s.accountSize+r.reward),stopText=edge('止损',stop,r.stopPercent,r.stopTicks,s.accountSize-r.risk);
    const detail=[...(s.showPnl?['浮动盈亏: '+number(r.markPnl,2)]:[]),...(s.showQuantity?['数量: '+number(r.quantity,s.quantityPrecision)]:[])].join(', ');
    const middle=[...(detail?[detail]:[]),...(s.showRatio?['风险/回报比: '+number(r.grossRatio,2)]:[])];
    const d=direction==='long'?1:-1;
    figures.push(...pill(center,ty-d*5,[targetText],s.targetColor,s,bounding,d===1?'bottom':'top'));
    figures.push(...pill(center,sy+d*5,[stopText],s.stopColor,s,bounding,d===1?'top':'bottom'));
    if(middle.length)figures.push(...pill(center,ey+5,middle,r.markPnl===null?s.lineColor:r.markPnl>=0?s.targetColor:s.stopColor,s,bounding));
   }
   if(active&&!overlay.lock){
    for(const [key,hx,hy]of [[POSITION_HANDLES.target,x,ty],[POSITION_HANDLES.stop,x,sy],[POSITION_HANDLES.entry,x,ey],[POSITION_HANDLES.width,right,ey]]){
     figures.push({key,type:'rect',attrs:{x:hx-8,y:hy-8,width:16,height:16},styles:{style:'fill',color:'rgba(0,0,0,0)'}},
      {type:'rect',attrs:{x:hx-3.5,y:hy-3.5,width:7,height:7,radius:1},styles:{style:'stroke_fill',color:'#ffffff',borderColor:'#2962ff',borderSize:1.5},ignoreEvent:true});
    }
   }
   return figures;
  },
  createYAxisFigures:({overlay,yAxis})=>{
   const s=positionSettings(overlay.extendData||{});if(!s.priceLabels||(!s.alwaysShowStats&&context.selected?.()!==overlay.id&&!overlay.isDrawing?.()))return [];
   const precision=context.precision?.()??2;
   return overlay.points.map((point,i)=>({type:'text',attrs:{x:0,y:yAxis.convertToPixel(point.value),text:number(point.value,precision),baseline:'middle',align:'left'},styles:{color:s.textColor,backgroundColor:i===0?s.lineColor:i===1?s.stopColor:s.targetColor,size:11,paddingLeft:4,paddingRight:4,paddingTop:2,paddingBottom:2},ignoreEvent:true}));
  },
 });
}
