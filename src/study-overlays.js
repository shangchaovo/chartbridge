import {anchoredVwap,regressionChannel,candleVolumeProfile,studyIndexRange} from './drawing-studies.js';
const line=(coordinates,color='#2962ff',style='solid')=>({type:'line',attrs:{coordinates},styles:{color,size:1.3,style}});
const text=(x,y,value,color='#2962ff')=>({type:'text',attrs:{x,y,text:value,baseline:'bottom'},styles:{color,size:10,backgroundColor:'rgba(19,23,34,.82)',paddingLeft:4,paddingRight:4},ignoreEvent:true});
const fmt=value=>Number(value.toFixed(5)).toLocaleString('en-US',{maximumFractionDigits:5});
export function registerStudyOverlays(register,context={}) {
  register({name:'infoLine',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay})=>{
    if(coordinates.length<2)return [];
    const [a,b]=coordinates,[p,q]=overlay.points,change=q.value-p.value,percent=p.value?change/Math.abs(p.value)*100:null;
    return [line(coordinates),text((a.x+b.x)/2,Math.min(a.y,b.y)-8,`${change>=0?'+':''}${fmt(change)} · ${percent===null?'—':fmt(percent)+'%'}${Number.isInteger(q.dataIndex)&&Number.isInteger(p.dataIndex)?' · '+Math.abs(q.dataIndex-p.dataIndex)+' 根间隔':''}`)];
  }});
  register({name:'localEllipse',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates})=>{
    if(coordinates.length<2)return [];const [a,b]=coordinates,cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2;
    return [line(Array.from({length:65},(_,i)=>({x:cx+rx*Math.cos(i*Math.PI/32),y:cy+ry*Math.sin(i*Math.PI/32)})))];
  }});
  register({name:'fibTimeZones',totalStep:3,needDefaultPointFigure:true,createPointFigures:({coordinates,overlay,bounding,xAxis})=>{
    if(coordinates.length<2)return [];const [a,b]=coordinates,[p,q]=overlay.points,d=(q.dataIndex??1)-(p.dataIndex??0);
    return [0,1,2,3,5,8,13,21].flatMap(factor=>{const x=xAxis&&Number.isInteger(p.dataIndex)?xAxis.convertToPixel(p.dataIndex+d*factor):a.x+(b.x-a.x)*factor;return [line([{x,y:0},{x,y:bounding.height}],'#2962ff','dashed'),text(x+3,16,String(factor))];});
  }});
  register({name:'anchoredVWAP',totalStep:2,needDefaultPointFigure:true,createPointFigures:({overlay,xAxis,yAxis})=>{
    const candles=context.candles?.()||[],range=studyIndexRange(candles,overlay.points);if(!range||!xAxis||!yAxis)return [];
    const values=anchoredVwap(candles,range[0]);if(!values.length)return [text(xAxis.convertToPixel(range[0]),30,'锚定 VWAP：缺少成交量')];
    const coordinates=values.map(p=>({x:xAxis.convertToPixel(p.index),y:yAxis.convertToPixel(p.value)})),end=coordinates.at(-1);
    return [line(coordinates,'#2962ff'),text(end.x-130,end.y-5,`锚定 VWAP ${fmt(values.at(-1).value)}`,'#2962ff')];
  }});
  register({name:'regressionChannel',totalStep:3,needDefaultPointFigure:true,createPointFigures:({overlay,xAxis,yAxis})=>{
    const candles=context.candles?.()||[],range=studyIndexRange(candles,overlay.points);if(!range||overlay.points.length<2||!xAxis||!yAxis)return [];
    const r=regressionChannel(candles,...range);if(!r)return [];
    const x1=xAxis.convertToPixel(range[0]),x2=xAxis.convertToPixel(range[1]);
    return [0,-2,2].map(factor=>line([{x:x1,y:yAxis.convertToPixel(r.start+factor*r.deviation)},{x:x2,y:yAxis.convertToPixel(r.end+factor*r.deviation)}],factor?'#787b86':'#2962ff',factor?'dashed':'solid'))
      .concat(text(x1,Math.min(yAxis.convertToPixel(r.start),yAxis.convertToPixel(r.end))-8,`回归通道 ±2σ · R² ${r.rSquared.toFixed(3)} · ${r.count} 根`));
  }});
  register({name:'fixedVolumeProfile',totalStep:3,needDefaultPointFigure:true,createPointFigures:({overlay,xAxis,yAxis})=>{
    const candles=context.candles?.()||[],range=studyIndexRange(candles,overlay.points);if(!range||overlay.points.length<2||!xAxis||!yAxis)return [];
    const p=candleVolumeProfile(candles.slice(range[0],range[1]+1));if(!p)return [text(xAxis.convertToPixel(range[0]),30,'区间量能分布：缺少成交量')];
    const x1=xAxis.convertToPixel(range[0]),x2=xAxis.convertToPixel(range[1]),right=Math.max(x1,x2),maxWidth=Math.max(30,Math.abs(x2-x1)*.4);
    const figures=p.bins.map((bin,index)=>{const y1=yAxis.convertToPixel(bin.low),y2=yAxis.convertToPixel(bin.high),width=bin.volume/p.max*maxWidth;return {type:'rect',attrs:{x:right-width,y:Math.min(y1,y2),width,height:Math.max(1,Math.abs(y2-y1)-1)},styles:{style:'fill',color:index===p.poc?'#2962ff':'#2962ff55'}};});
    const py=yAxis.convertToPixel(p.pocPrice);figures.push(line([{x:Math.min(x1,x2),y:py},{x:right,y:py}]),text(Math.min(x1,x2),py-5,`POC ${fmt(p.pocPrice)} · K线估算`));
    figures.push(text(Math.min(x1,x2),Math.min(yAxis.convertToPixel(p.vah),yAxis.convertToPixel(p.val))-12,`70% 价值区 ${fmt(p.val)} — ${fmt(p.vah)}`));return figures;
  }});
}
