import { chartDateTimeInput, parseChartDateTime } from './chart-time.js';
import { isFreehand } from './freehand.js';
import { isPath, isPolyline, MAX_PATH_POINTS, pathSettings } from './path-drawing.js';
import { curveSettings, isCurve } from './curve-drawing.js';
import { drawingColorStyles } from './drawing-colors.js';
import { mountDrawingColorControl } from './color-picker.js';
const CURVE_HINTS={localArc:'锚点 1、2 是两端，弧线经过锚点 3。',localCurve:'锚点 1、2 是两端，锚点 3 是控制点，决定弯曲方向和幅度。',localDoubleCurve:'锚点 1、2 是两端，锚点 3、4 分别是靠近起点和终点的控制点。'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hasText=name=>['localNote','simpleAnnotation','simpleTag'].includes(name);
export function drawingPatch(original,values,timezone){
  const width=Number(values.width),textSize=Number(values.textSize);
  if(!/^#[\da-f]{6}$/i.test(values.color)||!Number.isFinite(width)||width<1||width>24||!Number.isFinite(textSize)||textSize<8||textSize>40||!['solid','dashed'].includes(values.lineStyle))throw new Error('请检查颜色、线宽和文字大小。');
  const points=original.points.map((point,index)=>{
    const input=values.points?.[index];if(!input||original.lock||isFreehand(original.name))return {...point};
    const next={...point},price=String(point.value);
    if(input.price!==price){if(!String(input.price).trim()||!Number.isFinite(Number(input.price)))throw new Error(`锚点 ${index+1} 的价格无效。`);next.value=Number(input.price);}
    if(Number.isFinite(point.timestamp)){
      if(input.time!==chartDateTimeInput(point.timestamp,timezone)){const timestamp=parseChartDateTime(input.time,timezone,point.timestamp);if(timestamp===null)throw new Error(`锚点 ${index+1} 的时间无效，或处于夏令时跳过的时段。`);if(timestamp!==point.timestamp){next.timestamp=timestamp;delete next.dataIndex;}}
    }else if(input.index!==String(point.dataIndex)){
      const dataIndex=Number(input.index);if(!String(input.index).trim()||!Number.isSafeInteger(dataIndex))throw new Error(`锚点 ${index+1} 的 K 线索引无效。`);next.dataIndex=dataIndex;
    }
    return next;
  });
  const styles=drawingColorStyles(values.color,original.styles);
  styles.line={...styles.line,color:values.color,size:width,style:values.lineStyle};
  styles.text={...styles.text,color:values.color,size:textSize};
  for(const figure of ['rect','polygon','circle','arc'])styles[figure].borderSize=width;
  const polyline=isPolyline(original.name);
  let extendData;
  if(polyline){
    extendData=pathSettings({closed:Boolean(values.closed),fill:values.fill!==false});
    if(extendData.closed&&points.length<3)throw new Error('闭合折线至少需要 3 个锚点。');
  }
  if(isCurve(original.name)){
    const current=curveSettings(original.extendData,original.name);
    extendData=curveSettings({fill:values.fill===undefined?current.fill:Boolean(values.fill)},original.name);
  }
  return {points,styles,lock:Boolean(values.lock),...(hasText(original.name)?{extendData:String(values.text??'').slice(0,1000)}:{}),...(extendData?{extendData}:{})};
}
export function mountDrawingEditor({container,original,timezone,readonly=false,recentColors=()=>[],onSave,onCancel}){
  const color=/^#[\da-f]{6}$/i.test(original.styles?.line?.color)?original.styles.line.color:'#2962ff';
  const text=hasText(original.name),freehand=isFreehand(original.name),polyline=isPolyline(original.name),pathTool=isPath(original.name);
  const shape=polyline?pathSettings(original.extendData):null;
  let curve=null;if(isCurve(original.name))try{curve=curveSettings(original.extendData,original.name);}catch{curve=curveSettings(undefined,original.name);}
  container.innerHTML=`<form id="drawing-editor-form" class="drawing-editor"><nav class="drawing-editor-tabs" role="tablist" aria-label="绘图设置"><button type="button" role="tab" aria-selected="true" data-drawing-tab="style">样式</button><button type="button" role="tab" aria-selected="false" data-drawing-tab="coordinates">坐标</button></nav><div class="drawing-editor-body"><section data-drawing-page="style"><label>颜色<input type="color" name="color" value="${color}"></label><label>线宽<input type="number" name="width" value="${original.styles?.line?.size||1}" min="1" max="24" step="1" required></label><label>线型<select name="lineStyle"><option value="solid" ${original.styles?.line?.style!=='dashed'?'selected':''}>实线</option><option value="dashed" ${original.styles?.line?.style==='dashed'?'selected':''}>虚线</option></select></label><label>文字大小<input type="number" name="textSize" value="${original.styles?.text?.size||11}" min="8" max="40" required></label>${text?`<label class="drawing-text-field">文字<textarea name="text" maxlength="1000">${esc(original.extendData||'')}</textarea></label>`:''}${polyline?`<label>闭合<input type="checkbox" name="closed" ${shape.closed?'checked':''}></label><label>填充背景<input type="checkbox" name="fill" ${shape.fill?'checked':''}></label><p class="search-hint">点回起点会闭合。双击、右键或 Esc 结束时保持开口。最多 ${MAX_PATH_POINTS} 个节点。</p>`:pathTool?`<p class="search-hint">路径保持开口，按点击顺序连接，最多 ${MAX_PATH_POINTS} 个节点。</p>`:curve?`<label>填充背景<input type="checkbox" name="fill" ${curve.fill?'checked':''}></label>`:''}<label>锁定图形<input type="checkbox" name="lock" ${original.lock?'checked':''}></label></section><section data-drawing-page="coordinates" hidden><p class="search-hint">${esc(timezone)}${original.lock?' · 图形已锁定；解锁并重新打开后可改坐标。':''}</p>${curve?`<p class="search-hint">${CURVE_HINTS[original.name]}</p>`:''}${freehand?`<p class="search-hint">这条笔迹包含 ${original.points.length} 个采样点。拖动笔迹可整体移动，样式页可调整颜色和线宽。</p>`:original.points.map((point,index)=>`<fieldset ${original.lock?'disabled':''}><legend>锚点 ${index+1}</legend><label>价格<input type="number" step="any" data-price="${index}" aria-label="锚点 ${index+1} 价格" value="${esc(point.value)}" required></label>${Number.isFinite(point.timestamp)?`<label>时间<input type="datetime-local" step="0.001" data-time="${index}" aria-label="锚点 ${index+1} 时间" value="${chartDateTimeInput(point.timestamp,timezone)}" required></label>`:`<label>K 线索引<input type="number" step="1" data-index="${index}" aria-label="锚点 ${index+1} K 线索引" value="${point.dataIndex}" required></label>`}</fieldset>`).join('')}</section></div><p class="drawing-editor-error negative" role="status"></p><footer><button type="button" class="secondary" id="drawing-editor-cancel">取消</button><button class="primary" type="submit" ${readonly?'disabled':''}>确定</button></footer></form>`;
  const form=container.querySelector('form');form.noValidate=true;
  const nativeColor=form.elements.namedItem('color'),originalRow=nativeColor.closest('label'),row=document.createElement('div');
  nativeColor.type='hidden';row.className='drawing-editor-color-row';
  const colorLabel=document.createElement('span');colorLabel.textContent='颜色';
  const colorHost=document.createElement('div');row.append(colorLabel,colorHost);colorHost.append(nativeColor);originalRow.replaceWith(row);
  let colorChanged=false;
  const colorControl=mountDrawingColorControl({host:colorHost,input:nativeColor,recent:recentColors,onChange:()=>{colorChanged=true;}});
  colorControl.setDisabled(readonly);
  if(!text)container.querySelector('[name="textSize"]')?.closest('label')?.remove();
  if(readonly)for(const input of form.querySelectorAll('input,select,textarea'))input.disabled=true;
  for(const button of container.querySelectorAll('[data-drawing-tab]'))button.onclick=()=>{for(const tab of container.querySelectorAll('[data-drawing-tab]'))tab.setAttribute('aria-selected',String(tab===button));for(const page of container.querySelectorAll('[data-drawing-page]'))page.hidden=page.dataset.drawingPage!==button.dataset.drawingTab;};
  container.querySelector('#drawing-editor-cancel').onclick=onCancel;
  form.onsubmit=event=>{event.preventDefault();if(readonly)return;try{
    const value=name=>form.elements.namedItem(name)?.value;
    const points=original.points.map((point,index)=>({price:form.querySelector(`[data-price="${index}"]`)?.value,time:form.querySelector(`[data-time="${index}"]`)?.value,index:form.querySelector(`[data-index="${index}"]`)?.value}));
    onSave(drawingPatch(original,{color:value('color'),width:value('width'),lineStyle:value('lineStyle'),textSize:value('textSize')||original.styles?.text?.size||11,text:value('text'),lock:form.elements.namedItem('lock').checked,closed:form.elements.namedItem('closed')?.checked,fill:form.elements.namedItem('fill')?.checked,points},timezone),{colorChanged});
  }catch(error){container.querySelector('[role="status"]').textContent=error.message;}};
}
