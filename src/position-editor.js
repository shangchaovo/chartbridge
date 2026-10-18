import {calculatePosition,positionSettings,positionLevels,targetForRatio,DEFAULT_POSITION_SETTINGS} from './position-risk.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(value,digits=4)=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits}):'—';
export function mountPositionEditor({container,plan,mark,currency='',onSave,onExport,onCopy,onAlerts,onCancel,onDefaults}){
 const initial=positionSettings(plan.extendData||{}),levels=positionLevels(plan.points),direction=plan.name==='longPosition'?'long':'short';
 const num=(name,value,min=0,max='')=>'<input type="number" name="'+name+'" value="'+Number(Number(value).toPrecision(12))+'" step="any" min="'+min+'"'+(max!==''?' max="'+max+'"':'')+' required>';
 const row=(label,control,extra='')=>'<div class="position-input-row '+extra+'"><label>'+label+'</label><div>'+control+'</div></div>';
 const field=(name,label,min=0,max='')=>row(label,num(name,initial[name],min,max));
 const check=(key,label)=>'<label class="position-check"><input type="checkbox" name="'+key+'" '+(initial[key]?'checked':'')+'><span>'+label+'</span></label>';
 const color=(key,label)=>row(label,'<input type="color" name="'+key+'" value="'+initial[key]+'" aria-label="'+label+'">');
 const priceLevel=(key,label,value)=>'<section class="position-level"><h3>'+label+'</h3><div class="position-level-fields"><label>Ticks<input type="number" id="position-'+key+'-ticks" min="0" step="any" aria-label="'+label+' Tick"></label><label>价格'+num(key,value,1e-12)+'</label></div></section>';
 container.innerHTML='<form id="position-form" class="position-tv-form" novalidate>'+
 '<div class="position-tabs" role="tablist" aria-label="仓位设置"><button type="button" role="tab" id="position-tab-inputs" data-position-tab="inputs" aria-controls="position-panel-inputs" aria-selected="true">输入</button><button type="button" role="tab" id="position-tab-style" data-position-tab="style" aria-controls="position-panel-style" aria-selected="false" tabindex="-1">样式</button></div>'+
 '<div class="position-form-scroll"><section id="position-panel-inputs" role="tabpanel" aria-labelledby="position-tab-inputs">'+
 field('accountSize','账户资金',1e-8)+field('lotSize','每手数量 / 数量步长',1e-12)+
 row('风险',num('riskValue',initial.riskValue,1e-8)+'<select name="riskMode" aria-label="风险口径"><option value="percent" '+(initial.riskMode==='percent'?'selected':'')+'>%</option><option value="amount" '+(initial.riskMode==='amount'?'selected':'')+'>金额</option></select>','position-risk-row')+
 row('入场价格',num('entry',levels.entry,1e-12))+field('leverage','杠杆',1,1000)+
 priceLevel('target','盈利价位',levels.target)+priceLevel('stop','止损价位',levels.stop)+
 row('数量精度','<select name="quantityPrecision" aria-label="数量精度">'+Array.from({length:13},(_,i)=>'<option value="'+i+'" '+(i===initial.quantityPrecision?'selected':'')+'>'+i+' 位小数</option>').join('')+'</select>')+
 '<div class="position-presets"><span>风险 / 回报</span>'+[1,1.5,2,3,4,5].map(rr=>'<button type="button" data-position-rr="'+rr+'">1:'+rr+'</button>').join('')+'</div>'+
 '<details class="position-advanced"><summary>费用与高级仓位参数</summary>'+
 row('数量计算','<select name="quantityMode"><option value="risk" '+(initial.quantityMode==='risk'?'selected':'')+'>按风险计算</option><option value="manual" '+(initial.quantityMode==='manual'?'selected':'')+'>手动数量</option></select>')+
 field('quantity','手动数量',0)+field('multiplier','合约乘数',1e-12)+field('tickSize','最小跳动 / Tick',1e-12)+field('feeBps','单边费率（bp）',0,1000)+field('slippageBps','不利滑点（bp）',0,1000)+
 row('方向','<select name="direction" aria-label="仓位方向"><option value="long" '+(direction==='long'?'selected':'')+'>多头</option><option value="short" '+(direction==='short'?'selected':'')+'>空头</option></select>')+
 '<p class="position-help">10 bp = 0.1%。自动数量包含费用和滑点，并按步长与数量精度向下取整。期货与外汇需填写实际乘数。杠杆只影响保证金估算。</p><p class="position-help" id="position-advanced-result"></p></details></section>'+
 '<section id="position-panel-style" role="tabpanel" aria-labelledby="position-tab-style" hidden>'+
 color('lineColor','线条颜色')+row('线条宽度','<select name="lineWidth">'+[1,2,3,4].map(n=>'<option '+(n===initial.lineWidth?'selected':'')+'>'+n+'</option>').join('')+'</select>')+
 color('stopColor','止损区域')+color('targetColor','目标区域')+row('区域不透明度','<input type="range" name="fillOpacity" min="0" max="80" step="1" value="'+initial.fillOpacity+'" aria-label="区域不透明度"><output id="position-opacity">'+initial.fillOpacity+'%</output>')+
 color('textColor','文字颜色')+row('文字大小','<select name="fontSize">'+Array.from({length:11},(_,i)=>i+10).map(n=>'<option value="'+n+'" '+(n===initial.fontSize?'selected':'')+'>'+n+'</option>').join('')+'</select>')+
 '<div class="position-style-switches">'+check('priceLabels','价格标签')+check('showStats','显示统计')+check('compact','紧凑统计模式')+check('alwaysShowStats','始终显示统计')+'</div>'+
 '<h3 class="position-style-heading">统计内容</h3><div class="position-stat-options">'+check('showAmount','目标 / 止损金额')+check('showPercent','价格百分比')+check('showTicks','Tick 距离')+check('showPnl','浮动盈亏')+check('showQuantity','数量')+check('showRatio','风险 / 回报比')+'</div></section>'+
 '<div id="position-results" aria-live="polite"></div><div id="position-error" role="alert"></div></div>'+
 '<div class="position-footer"><details class="position-more"><summary>更多 ▾</summary><div><button type="button" id="position-defaults">保存为默认设置</button><button type="button" id="position-reset">恢复默认设置</button><button type="button" id="position-alerts">添加止盈 / 止损提醒</button><button type="button" id="position-copy">复制计划</button><button type="button" id="position-export">导出 JSON</button></div></details><span></span><button class="secondary" type="button" id="position-cancel">取消</button><button class="primary" type="submit">确定</button></div>'+
 '<div class="position-plan-note">图表计划 · '+esc(currency||'当前计价单位')+' · 不发送交易订单</div></form>';
 const form=container.querySelector('form'),error=container.querySelector('#position-error'),output=container.querySelector('#position-results');
 const input=name=>form.elements.namedItem(name);
 const displayed=Object.fromEntries([...form.elements].filter(control=>control.name).map(control=>[control.name,control.value]));
 const readNumber=(key,original)=>input(key).value===displayed[key]?original:Number(input(key).value);
 const price=value=>Number(Number(value).toPrecision(12));
 for(const field of container.querySelectorAll('.position-input-row')){const control=field.querySelector('input,select'),label=field.querySelector('label');if(control&&label){control.id||='position-input-'+control.name;label.htmlFor=control.id;}}
 const tabs=[...container.querySelectorAll('[data-position-tab]')];
 function tab(name){for(const button of tabs){const selected=button.dataset.positionTab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;container.querySelector('#position-panel-'+button.dataset.positionTab).hidden=!selected;}}
 for(const button of tabs){button.onclick=()=>tab(button.dataset.positionTab);button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[1-tabs.indexOf(button)];tab(next.dataset.positionTab);next.focus();}};}
 function read(){
  const settings=positionSettings(Object.fromEntries(Object.entries(initial).map(([key,value])=>[key,key==='version'?1:typeof value==='boolean'?input(key).checked:typeof value==='number'?readNumber(key,value):input(key).value])));
  return {direction:input('direction').value,entry:readNumber('entry',levels.entry),stop:readNumber('stop',levels.stop),target:readNumber('target',levels.target),settings};
 }
 function preview(){
  try{
   const value=read();if(!form.checkValidity())throw new Error('请填写有效且完整的价格与仓位参数。');
   const r=calculatePosition({...value,mark});error.textContent='';
   input('quantity').disabled=value.settings.quantityMode!=='manual';
   container.querySelector('#position-stop-ticks').value=Number(r.stopTicks.toFixed(6));container.querySelector('#position-target-ticks').value=Number(r.targetTicks.toFixed(6));
   container.querySelector('#position-opacity').value=value.settings.fillOpacity+'%';
   container.querySelector('#position-advanced-result').textContent='保证金估算 '+fmt(r.margin,2)+' '+currency+' · 名义价值 '+fmt(r.notional,2)+' '+currency+' · 盈亏平衡胜率 '+(r.breakevenWinRate===null?'—':fmt(r.breakevenWinRate,2)+'%');
   const metrics=[['风险 / 回报比','1 : '+fmt(r.grossRatio,2)],['计划数量',fmt(r.quantity,value.settings.quantityPrecision)],['止损风险',fmt(r.risk,2)+' '+currency],['止盈收益',fmt(r.reward,2)+' '+currency]];
   output.innerHTML='<div class="position-summary">'+metrics.map(([label,v],i)=>'<div data-position-metric="'+['ratio','quantity','risk','reward'][i]+'"><span>'+label+'</span><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
    (value.settings.feeBps||value.settings.slippageBps?'<p class="position-cost-summary">扣费 / 滑点后盈亏比 1 : '+fmt(r.netRatio,4)+'</p>':'')+
    (r.insufficientLot?'<p class="position-warning">'+(value.settings.quantityMode==='manual'?'手动数量小于一个数量步长。':'风险预算不足一个数量步长，计划数量为 0。')+'</p>':'')+
    (r.exceedsRisk?'<p class="position-warning">手动数量对应的风险超过当前风险预算。</p>':'')+
    (r.exceedsMargin?'<p class="position-warning">估算保证金超过账户资金。保证金按名义价值 ÷ 杠杆估算。</p>':'')+
    (r.rewardPerUnit<=0?'<p class="position-warning">止盈距离不足以覆盖费用与滑点。</p>':'');
   return {...value,metrics:r};
  }catch(e){error.textContent=e.message;output.innerHTML='';return null;}
 }
 let previousDirection=direction;
 input('direction').addEventListener('change',()=>{const d=input('direction').value==='long'?1:-1,e=Number(input('entry').value);if(previousDirection!==input('direction').value){input('stop').value=price(e-d*Math.abs(e-Number(input('stop').value)));input('target').value=price(e+d*Math.abs(Number(input('target').value)-e));previousDirection=input('direction').value;}preview();});
 form.addEventListener('input',preview);form.addEventListener('change',preview);
 container.querySelectorAll('[data-position-rr]').forEach(button=>button.onclick=()=>{try{input('target').value=price(targetForRatio(input('direction').value,Number(input('entry').value),Number(input('stop').value),Number(button.dataset.positionRr)));preview();}catch(e){error.textContent=e.message;}});
 for(const [key,sign]of [['stop',-1],['target',1]])container.querySelector('#position-'+key+'-ticks').addEventListener('input',event=>{event.stopPropagation();const d=input('direction').value==='long'?1:-1;input(key).value=price(Number(input('entry').value)+sign*d*Number(event.target.value)*Number(input('tickSize').value));preview();});
 form.onsubmit=event=>{event.preventDefault();const value=preview();if(value)onSave(value);};
 container.querySelector('#position-cancel').onclick=()=>onCancel?.();
 for(const [id,callback]of [['position-export',onExport],['position-copy',onCopy],['position-alerts',onAlerts]])container.querySelector('#'+id).onclick=()=>{const value=preview();if(value)callback?.(value);container.querySelector('.position-more').open=false;};
 container.querySelector('#position-defaults').onclick=()=>{const value=preview();if(value)onDefaults?.(value.settings);container.querySelector('.position-more').open=false;};
 container.querySelector('#position-reset').onclick=()=>{for(const [key,value]of Object.entries(DEFAULT_POSITION_SETTINGS)){if(key==='version')continue;const control=input(key);if(typeof value==='boolean')control.checked=value;else control.value=String(value);}container.querySelector('.position-more').open=false;preview();};
 preview();
}
