export const FREEHAND_NAMES=Object.freeze(['localBrush','localHighlighter']);
export const MAX_FREEHAND_POINTS=256;
export const isFreehand=name=>FREEHAND_NAMES.includes(name);
const distanceSquared=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return (p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;
};
// Ramer-Douglas-Peucker reduction in screen space, preserving both endpoints.
export function simplifyStroke(samples,tolerance=1.2,limit=MAX_FREEHAND_POINTS){
  if(samples.length<=2)return samples.slice();
  const simplify=epsilon=>{
    const keep=new Set([0,samples.length-1]),stack=[[0,samples.length-1]];
    while(stack.length){const [start,end]=stack.pop();let max=epsilon*epsilon,index=-1;for(let i=start+1;i<end;i++){const distance=distanceSquared(samples[i],samples[start],samples[end]);if(distance>max){max=distance;index=i;}}if(index>=0){keep.add(index);stack.push([start,index],[index,end]);}}
    return [...keep].sort((a,b)=>a-b).map(index=>samples[index]);
  };
  let result=simplify(tolerance);
  while(result.length>limit){tolerance=Math.max(.1,tolerance*1.5);result=simplify(tolerance);}
  return result;
}
export function registerFreehandOverlays(register){
  for(const name of FREEHAND_NAMES)register({name,totalStep:1,needDefaultPointFigure:false,needDefaultXAxisFigure:false,needDefaultYAxisFigure:false,
    styles:{line:{color:name==='localHighlighter'?'#fbc02d':'#2962ff',size:name==='localHighlighter'?14:2,style:'solid'}},
    createPointFigures:({coordinates,overlay,barSpace})=>{
      const shifted=coordinates.map((point,index)=>({...point,x:point.x+(overlay.points[index]?.xOffset||0)*barSpace.bar}));
      if(!shifted.length)return [];
      const highlighter=name==='localHighlighter',base=overlay.styles?.line?.color||'#2962ff',color=highlighter&&/^#[\da-f]{6}$/i.test(base)?`${base}55`:base;
      const size=overlay.styles?.line?.size||(highlighter?14:2);
      if(shifted.length===1)return [{type:'circle',attrs:{...shifted[0],r:size/2},styles:{color},key:'freehand-stroke'}];
      return [{type:'line',attrs:{coordinates:shifted},styles:{color,size,style:overlay.styles?.line?.style||'solid'},key:'freehand-stroke'}];
    }});
}
