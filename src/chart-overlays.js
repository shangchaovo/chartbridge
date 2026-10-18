export function rangeMeasurement(points) {
  if(points.length<2||!points.every(point=>Number.isFinite(point.value)))return null;
  const [start,end]=points,change=end.value-start.value;
  return {change,percent:start.value===0?null:change/Math.abs(start.value)*100,
    bars:Number.isInteger(start.dataIndex)&&Number.isInteger(end.dataIndex)?Math.abs(end.dataIndex-start.dataIndex):null,
    elapsed:Number.isFinite(start.timestamp)&&Number.isFinite(end.timestamp)?Math.abs(end.timestamp-start.timestamp):null};
}
const line = (coordinates,styles={}) => ({type:'line',attrs:{coordinates},styles});
const colorOf = overlay => overlay.styles?.line?.color||'#2962ff';
const number = value => Number(value.toFixed(6)).toLocaleString('en-US',{maximumFractionDigits:6});
export function registerChartOverlays(register) {
  register({name:'crossLine',totalStep:2,needDefaultPointFigure:true,createPointFigures:({coordinates,bounding})=>coordinates.length?[
    line([{x:0,y:coordinates[0].y},{x:bounding.width,y:coordinates[0].y}]),
    line([{x:coordinates[0].x,y:0},{x:coordinates[0].x,y:bounding.height}]),
  ]:[]});
  register({name:'arrowLine',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates})=>{
    if(coordinates.length<2)return [];
    const [a,b]=coordinates,angle=Math.atan2(b.y-a.y,b.x-a.x),size=12;
    return [line([a,b]),line([{x:b.x-size*Math.cos(angle-.45),y:b.y-size*Math.sin(angle-.45)},b,{x:b.x-size*Math.cos(angle+.45),y:b.y-size*Math.sin(angle+.45)}])];
  }});
  register({name:'localCircle',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay})=>{
    if(coordinates.length<2)return [];
    const [a,b]=coordinates;
    return [{type:'circle',attrs:{x:a.x,y:a.y,r:Math.hypot(b.x-a.x,b.y-a.y)},styles:{style:'stroke_fill',borderColor:colorOf(overlay),borderSize:overlay.styles?.line?.size||1,color:`${colorOf(overlay)}18`}}];
  }});
  register({name:'localTriangle',totalStep:4,needDefaultPointFigure:true,createPointFigures:({coordinates})=>coordinates.length>1?[line([...coordinates,...(coordinates.length===3?[coordinates[0]]:[])])]:[]});
  register({name:'fibExtension',totalStep:4,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay,yAxis})=>{
    if(coordinates.length<2)return [];
    const [a,b,c]=coordinates,figures=[line(coordinates,{style:'dashed'})];
    if(!c)return figures;
    const points=overlay.points;
    for(const ratio of [0,.382,.5,.618,1,1.272,1.618,2.618]){
      const value=points[2].value+(points[1].value-points[0].value)*ratio;
      const y=yAxis?.convertToPixel(value)??c.y+(b.y-a.y)*ratio,x=Math.max(a.x,b.x,c.x)+120;
      figures.push(line([{x:Math.min(a.x,b.x,c.x),y},{x,y}]));
      figures.push({type:'text',attrs:{x,y,text:`${ratio}  ${number(value)}`,align:'right',baseline:'bottom'},styles:{color:colorOf(overlay),size:10},ignoreEvent:true});
    }
    return figures;
  }});
  for(const name of ['priceRange','dateRange','datePriceRange'])register({name,totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay})=>{
    if(coordinates.length<2)return [];
    const [a,b]=coordinates,m=rangeMeasurement(overlay.points);
    if(!m)return [];
    const color=m.change>=0?'#089981':'#f23645',x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),width=Math.abs(b.x-a.x),height=Math.abs(b.y-a.y);
    const parts=[];
    if(name!=='dateRange')parts.push(`${m.change>=0?'+':''}${number(m.change)} (${m.percent===null?'—':m.percent.toFixed(2)+'%'})`);
    if(name!=='priceRange'){
      if(m.bars!==null)parts.push(`${m.bars} 根间隔`);
      if(m.elapsed!==null){const minutes=m.elapsed/60000;parts.push(minutes>=1440?`${number(minutes/1440)} 天`:minutes>=60?`${number(minutes/60)} 小时`:`${number(minutes)} 分钟`);}
    }
    return [{type:'rect',attrs:{x,y,width:Math.max(1,width),height:Math.max(1,height)},styles:{style:'stroke_fill',borderColor:color,borderSize:1,color:`${color}18`}},
      {type:'text',attrs:{x:x+width/2,y:y-7,text:parts.join(' · '),align:'center',baseline:'bottom'},styles:{color,size:11,backgroundColor:'#10151e',paddingLeft:6,paddingRight:6,paddingTop:4,paddingBottom:4},ignoreEvent:true}];
  }});
}
