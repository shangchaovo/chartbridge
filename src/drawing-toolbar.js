import {icon} from './icons.js';
import {DRAWING_GROUPS,DRAWING_TOOLS} from './drawing-catalog.js';
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let menu=null,anchor=null;
export function closeDrawingMenu() {menu?.remove();menu=null;anchor?.setAttribute('aria-expanded','false');anchor=null;}
export function renderDrawingToolbar({host,active,choices,magnet,keepDrawing,locked,hidden,readonly,onSelect,onAction,shortcutFor}) {
  closeDrawingMenu();
  const shortcutText=(name,fallback)=>shortcutFor?shortcutFor(name):fallback;
  const control=(id,glyph,label,pressed=false,extra='')=>`<button type="button" id="${id}" class="${pressed?'active':''}" title="${label}" aria-label="${label}" aria-pressed="${pressed}" ${extra}>${icon(glyph)}</button>`;
  host.innerHTML=control('cursor-tool','cursor','选择与拖动 · Esc',!active)+DRAWING_GROUPS.map(group=>{
    const tool=group.tools.find(([name])=>name===choices[group.id])||group.tools[0];
    const shortcut=shortcutText(tool[0],tool[3]);
    return `<div class="drawing-group">${control(`tool-${group.id}`,tool[2],`${tool[1]}${shortcut?' · '+shortcut:''}`,active===tool[0],`data-tool="${tool[0]}" ${readonly?'disabled':''}`)}<button type="button" class="tool-more" data-tool-group="${group.id}" aria-label="展开${group.label}" aria-haspopup="menu" aria-expanded="false">${icon('chevronRight')}</button></div>`;
  }).join('')+`<span class="tool-divider"></span>`+
    control('magnet-tool','magnet',`磁吸：${{normal:'关闭',weak_magnet:'弱磁吸',strong_magnet:'强磁吸'}[magnet]} · 点击切换`,magnet!=='normal')+
    control('keep-drawing-tool','keepDrawing','连续绘图',keepDrawing)+
    control('lock-tool',locked?'lock':'unlock',locked?'解锁全部画线':'锁定全部画线',locked,readonly?'disabled':'')+
    control('hide-drawings-tool',hidden?'eyeOff':'eye',hidden?'显示全部画线':'隐藏全部画线',hidden)+
    control('drawing-manager-tool','objects','图形对象管理')+
    `<span class="tool-divider"></span>`+control('alert-tool','alert','警报')+
    control('shortcuts-tool','keyboard','快捷键说明')+
    control('delete-drawings','trash','清除当前图表画线 · 可撤销',false,readonly?'disabled':'');
  host.querySelector('#cursor-tool').onclick=()=>onSelect('');
  host.querySelectorAll('[data-tool]').forEach(button=>button.onclick=()=>onSelect(button.dataset.tool));
  host.querySelectorAll('[data-tool-group]').forEach(button=>button.onclick=event=>{
    event.stopPropagation();
    const group=DRAWING_GROUPS.find(item=>item.id===button.dataset.toolGroup);
    const isOpen=anchor===button;closeDrawingMenu();if(isOpen)return;
    menu=document.createElement('div');menu.className='drawing-flyout';menu.setAttribute('role','menu');menu.setAttribute('aria-label',group.label);
    menu.innerHTML=`<div class="flyout-title">${group.label}</div>`+group.tools.map(([name,label,glyph,fallback])=>{const shortcut=shortcutText(name,fallback);return `<button type="button" role="menuitem" data-choose-tool="${name}" class="${name===active?'selected':''}" ${readonly?'disabled':''}>${icon(glyph)}<span>${escape(label)}</span>${shortcut?`<kbd>${escape(shortcut)}</kbd>`:''}</button>`;}).join('');
    document.body.append(menu);anchor=button;button.setAttribute('aria-expanded','true');
    const rect=button.getBoundingClientRect();
    menu.style.left=`${rect.right+5}px`;menu.style.top=`${Math.max(8,Math.min(rect.top,innerHeight-menu.offsetHeight-8))}px`;
    menu.querySelectorAll('[data-choose-tool]').forEach(item=>item.onclick=()=>{const name=item.dataset.chooseTool;closeDrawingMenu();onSelect(name);});
    menu.addEventListener('keydown',event=>{
      const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(event.key==='Escape'){event.preventDefault();const trigger=anchor;closeDrawingMenu();trigger?.focus();}
    });
    menu.querySelector('button:not(:disabled)')?.focus();
  });
  for(const id of ['magnet-tool','keep-drawing-tool','lock-tool','hide-drawings-tool','drawing-manager-tool','alert-tool','shortcuts-tool','delete-drawings'])host.querySelector(`#${id}`).onclick=()=>onAction(id);
}
document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target)&&!anchor?.contains(event.target))closeDrawingMenu();});
window.addEventListener('resize',closeDrawingMenu);
export function drawingChoice(name) {return DRAWING_TOOLS.find(tool=>tool.name===name);}
