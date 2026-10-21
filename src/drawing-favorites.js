import {DRAWING_TOOLS} from './drawing-catalog.js';
import {icon} from './icons.js';
import {clampBox} from './chart-legend.js';

export const DRAWING_FAVORITES_KEY='shanhai-drawing-favorites';
const defaultTools=['parallelStraightLine','horizontalStraightLine','longPosition','shortPosition','segment','localPath','rect','localCircle'];
const toolsByName=new Map(DRAWING_TOOLS.map(tool=>[tool.name,tool]));
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function readDrawingFavorites(storage){
  let value;
  try{value=JSON.parse(storage.getItem(DRAWING_FAVORITES_KEY)||'null');}catch{}
  return {
    tools:Array.isArray(value?.tools)?[...new Set(value.tools.filter(name=>toolsByName.has(name)))]:[...defaultTools],
    visible:value?.visible!==false,
    position:Number.isFinite(value?.position?.x)&&Number.isFinite(value?.position?.y)?{x:value.position.x,y:value.position.y}:{x:12,y:80},
  };
}
export function writeDrawingFavorites(storage,value){
  try{storage.setItem(DRAWING_FAVORITES_KEY,JSON.stringify(value));}catch{ /* Keep the controls usable if browser storage is full or disabled. */ }
}

// The bar shares the existing drawing actions. Only its personal preferences live here.
export function mountDrawingFavorites({host,onSelect,onPosition}){
  const bar=document.createElement('div');
  bar.id='drawing-favorites';bar.className='drawing-favorites hidden';
  bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','收藏绘图工具');
  bar.innerHTML=`<button type="button" class="favorites-grip" aria-label="移动收藏工具栏" title="拖动移动工具栏；方向键微调，Shift 加速">${icon('grip')}</button><div class="favorites-tools"></div>`;
  host.append(bar);
  const grip=bar.querySelector('.favorites-grip'),list=bar.querySelector('.favorites-tools');
  const legend=host.querySelector('.chart-legend');
  let position={x:12,y:80},drag=null,automaticPosition=true;
  function place(next=position){
    // Keep the default bar below a wrapping legend; explicitly placed bars stay personal.
    const desired=automaticPosition&&legend?{x:12,y:Math.max(80,legend.offsetTop+legend.offsetHeight+10)}:next;
    position=clampBox(desired,{minX:8,minY:8,maxX:host.clientWidth-bar.offsetWidth-8,maxY:host.clientHeight-bar.offsetHeight-8});
    bar.style.left=`${position.x}px`;bar.style.top=`${position.y}px`;
  }
  function finish(event){
    if(!drag||event.pointerId!==drag.id)return;
    const id=drag.id;drag=null;bar.classList.remove('dragging');
    if(grip.hasPointerCapture(id))grip.releasePointerCapture(id);
    onPosition({...position});
  }
  grip.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    automaticPosition=false;
    event.preventDefault();grip.focus({preventScroll:true});
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,start:{...position}};
    grip.setPointerCapture(event.pointerId);bar.classList.add('dragging');
  });
  grip.addEventListener('pointermove',event=>{
    if(drag?.id===event.pointerId)place({x:drag.start.x+event.clientX-drag.x,y:drag.start.y+event.clientY-drag.y});
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])grip.addEventListener(name,finish);
  grip.addEventListener('keydown',event=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!delta)return;
    automaticPosition=false;
    event.preventDefault();event.stopPropagation();
    const step=event.shiftKey?10:1;place({x:position.x+delta[0]*step,y:position.y+delta[1]*step});onPosition({...position});
  });
  list.addEventListener('click',event=>{const button=event.target.closest('[data-favorite-tool]');if(button&&!button.disabled)onSelect(button.dataset.favoriteTool);});
  list.addEventListener('keydown',event=>{
    const buttons=[...list.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
    if(!buttons.length||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();
  });
  // Pointer events on the bar must never start or complete a chart drawing.
  for(const name of ['pointerdown','pointermove','pointerup','click','dblclick','contextmenu','wheel'])bar.addEventListener(name,event=>{event.stopPropagation();if(name==='contextmenu')event.preventDefault();});
  const observer=new ResizeObserver(()=>{if(!bar.classList.contains('hidden'))place();});
  observer.observe(host);observer.observe(bar);if(legend)observer.observe(legend);
  return {
    update({preferences,active,readonly,shortcutFor}){
      const focused=list.querySelector(':focus')?.dataset.favoriteTool;
      list.innerHTML=preferences.tools.map(name=>{
        const tool=toolsByName.get(name),shortcut=shortcutFor(name),label=`${tool.label}${shortcut?' · '+shortcut:''}`;
        return `<button type="button" data-favorite-tool="${name}" class="${name===active?'active':''}" title="${escape(label)}" aria-label="${escape(label)}" aria-pressed="${name===active}" ${readonly?'disabled':''}>${icon(tool.icon)}</button>`;
      }).join('');
      bar.classList.toggle('hidden',!preferences.visible||!preferences.tools.length);
      if(!drag){automaticPosition=preferences.position?.x===12&&preferences.position?.y===80;place(preferences.position);}
      if(focused)list.querySelector(`[data-favorite-tool="${focused}"]`)?.focus({preventScroll:true});
    },
  };
}
