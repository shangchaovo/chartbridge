export const POSITION_TYPES=['longPosition','shortPosition'];
export const isPosition=name=>POSITION_TYPES.includes(name);
export const DEFAULT_POSITION_SETTINGS=Object.freeze({version:1,accountSize:10000,riskMode:'percent',riskValue:1,quantityMode:'risk',quantity:1,lotSize:.001,multiplier:1,leverage:1,feeBps:0,slippageBps:0,tickSize:.01,showStats:true,compact:false,alwaysShowStats:false,priceLabels:true,showAmount:true,showPercent:true,showTicks:true,showQuantity:true,showPnl:true,showRatio:true,quantityPrecision:3,fontSize:12,fillOpacity:20,targetColor:'#089981',stopColor:'#f23645',textColor:'#ffffff',lineColor:'#787b86',lineWidth:1});
const fields=Object.keys(DEFAULT_POSITION_SETTINGS);
export function positionSettings(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('仓位参数格式无效。');
  const s={...DEFAULT_POSITION_SETTINGS,...value};
  if(!Object.hasOwn(value,'quantityPrecision')&&typeof value.lotSize==='number'){
    const [coefficient,exponent='0']=value.lotSize.toString().toLowerCase().split('e');
    s.quantityPrecision=Math.min(12,Math.max(3,(coefficient.split('.')[1]?.length||0)-Number(exponent)));
  }
  if(s.version!==1||!['percent','amount'].includes(s.riskMode)||!['risk','manual'].includes(s.quantityMode))throw new Error('仓位参数版本或模式无效。');
  for(const key of ['showStats','compact','alwaysShowStats','priceLabels','showAmount','showPercent','showTicks','showQuantity','showPnl','showRatio'])if(typeof s[key]!=='boolean')throw new Error('仓位显示设置无效。');
  for(const key of ['targetColor','stopColor','textColor','lineColor'])if(typeof s[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(s[key]))throw new Error('仓位颜色必须是有效的十六进制颜色。');
  for(const [key,min,max] of [['accountSize',1e-8,1e15],['riskValue',1e-8,s.riskMode==='percent'?100:1e15],['quantity',0,1e12],['lotSize',1e-12,1e12],['multiplier',1e-12,1e12],['leverage',1,1000],['feeBps',0,1000],['slippageBps',0,1000],['tickSize',1e-12,1e12],['quantityPrecision',0,12],['fontSize',10,20],['fillOpacity',0,80],['lineWidth',1,4]]){
    if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw new Error(`仓位参数 ${key} 超出范围。`);
  }
  for(const key of ['quantityPrecision','fontSize','fillOpacity','lineWidth'])if(!Number.isInteger(s[key]))throw new Error('仓位样式和数量精度必须为整数。');
  return s;
}
export function positionLevels(points) {
  return {entry:points?.[0]?.value,stop:points?.[1]?.value,target:points?.[2]?.value};
}
export function targetForRatio(direction,entry,stop,ratio) {
  if(!['long','short'].includes(direction)||![entry,stop,ratio].every(Number.isFinite)||ratio<=0)throw new Error('盈亏比参数无效。');
  const target=entry+(direction==='long'?1:-1)*Math.abs(entry-stop)*ratio;
  if(target<=0)throw new Error('当前止损距离下，该盈亏比会使止盈价小于或等于零。');
  return target;
}
function floorQuantity(value,step) {
  return Number((Math.floor(value/step+1e-10)*step).toPrecision(14));
}
function quantityStep(lotSize,precision){
  // Use a common multiple so rounding to decimal precision cannot break lot size
  // (e.g. a .03 lot with one decimal requires .3 units, rather than .1).
  const [coefficient,exponent='0']=lotSize.toString().toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.');
  const places=Math.max(fraction.length-Number(exponent),precision,0),scale=10n**BigInt(places);
  const lot=BigInt(whole+fraction)*10n**BigInt(places+Number(exponent)-fraction.length),decimal=10n**BigInt(places-precision);
  let a=lot,b=decimal;while(b){const rest=a%b;a=b;b=rest;}
  return Number(lot/a*decimal)/Number(scale);
}
export function calculatePosition({direction,entry,stop,target,settings={},mark=null}) {
  const s=positionSettings(settings),d=direction==='long'?1:direction==='short'?-1:0;
  if(!d||![entry,stop,target].every(value=>Number.isFinite(value)&&value>0))throw new Error('入场、止损和止盈必须是有效正价格。');
  if(d*(entry-stop)<=0)throw new Error(direction==='long'?'多头止损必须低于入场价。':'空头止损必须高于入场价。');
  if(d*(target-entry)<=0)throw new Error(direction==='long'?'多头止盈必须高于入场价。':'空头止盈必须低于入场价。');
  const slip=s.slippageBps/10000,fee=s.feeBps/10000,m=s.multiplier;
  const entryFill=entry*(1+d*slip),stopFill=stop*(1-d*slip),targetFill=target*(1-d*slip);
  const grossRiskPerUnit=d*(entry-stop)*m,grossRewardPerUnit=d*(target-entry)*m;
  const riskPerUnit=(d*(entryFill-stopFill)+fee*(entryFill+stopFill))*m;
  const rewardPerUnit=(d*(targetFill-entryFill)-fee*(entryFill+targetFill))*m;
  const riskBudget=s.riskMode==='percent'?s.accountSize*s.riskValue/100:s.riskValue;
  const step=quantityStep(s.lotSize,s.quantityPrecision);
  let quantity=floorQuantity(Math.min(1e12,s.quantityMode==='risk'?riskBudget/riskPerUnit:s.quantity),step);
  if(s.quantityMode==='risk'&&quantity*riskPerUnit>riskBudget*(1+1e-12))quantity=Math.max(0,Number((quantity-step).toPrecision(14)));
  const risk=quantity*riskPerUnit,reward=quantity*rewardPerUnit,notional=quantity*entryFill*m;
  const markFill=Number.isFinite(mark)&&mark>0?mark*(1-d*slip):null;
  const result={direction,entry,stop,target,quantity,riskBudget,risk,reward,notional,margin:notional/s.leverage,
    grossRisk:quantity*grossRiskPerUnit,grossReward:quantity*grossRewardPerUnit,grossRatio:grossRewardPerUnit/grossRiskPerUnit,
    netRatio:rewardPerUnit/riskPerUnit,stopPercent:Math.abs(entry-stop)/entry*100,targetPercent:Math.abs(target-entry)/entry*100,
    stopTicks:Math.abs(entry-stop)/s.tickSize,targetTicks:Math.abs(target-entry)/s.tickSize,
    breakevenWinRate:rewardPerUnit>0?riskPerUnit/(riskPerUnit+rewardPerUnit)*100:null,
    markPnl:markFill===null?null:quantity*(d*(markFill-entryFill)-fee*(entryFill+markFill))*m,
    exceedsRisk:risk>riskBudget*(1+1e-10),insufficientLot:quantity===0,exceedsMargin:notional/s.leverage>s.accountSize,
    entryFill,stopFill,targetFill,riskPerUnit,rewardPerUnit};
  if(Object.values(result).some(value=>typeof value==='number'&&!Number.isFinite(value)))throw new Error('仓位数值过大，无法可靠计算。');
  return result;
}

// Keep fixed-anchor drawings on the correct side of entry while dragging.
export function constrainPositionPoints(points,direction,tick=.01) {
  if(!points.length||!Number.isFinite(points[0].value)||points[0].value<=0)return;
  const entry=points[0].value,d=direction==='long'?1:-1;
  const gap=Math.min(entry*.25,Math.max(Math.min(tick,entry*.01),entry*1e-8));
  if(points[1])points[1].value=d===1?Math.max(gap,Math.min(points[1].value,entry-gap)):Math.max(points[1].value,entry+gap);
  if(points[2])points[2].value=d===1?Math.max(points[2].value,entry+gap):Math.max(gap,Math.min(points[2].value,entry-gap));
}
