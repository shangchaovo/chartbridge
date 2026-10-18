import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePosition,positionSettings,targetForRatio} from '../src/position-risk.js';
import {anchoredVwap,regressionChannel,candleVolumeProfile,studyIndexRange} from '../src/drawing-studies.js';
import {SharedCharts} from '../server/shared-charts.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ~= ${b}`);
const plan=(direction='long',extra={})=>({direction,entry:100,stop:direction==='long'?95:105,target:direction==='long'?110:90,settings:{lotSize:1,...extra}});
test('long and short plans calculate risk sizing and reward symmetrically without costs',()=>{
  for(const direction of ['long','short']){
    const r=calculatePosition({...plan(direction),mark:direction==='long'?103:97});
    assert.equal(r.quantity,20);assert.equal(r.risk,100);assert.equal(r.reward,200);assert.equal(r.grossRatio,2);assert.equal(r.netRatio,2);assert.equal(r.markPnl,60);close(r.breakevenWinRate,100/3);
  }
});
test('risk budget includes both fees and adverse entry/exit slippage before rounding quantity',()=>{
  const long=calculatePosition(plan('long',{feeBps:10,slippageBps:10}));
  close(long.riskPerUnit,5.390005);close(long.rewardPerUnit,9.58001);assert.equal(long.quantity,18);assert.ok(long.risk<=long.riskBudget);assert.ok(long.netRatio<long.grossRatio);
  const short=calculatePosition(plan('short',{feeBps:10,slippageBps:10}));close(short.riskPerUnit,5.410005);close(short.rewardPerUnit,9.62001);assert.ok(short.risk<=100);
});
test('leverage changes estimated margin, not risk sizing or price risk',()=>{
  const base=calculatePosition(plan()),leveraged=calculatePosition(plan('long',{leverage:10}));
  assert.equal(leveraged.quantity,base.quantity);assert.equal(leveraged.risk,base.risk);assert.equal(leveraged.margin,base.margin/10);
  const contract=calculatePosition(plan('long',{multiplier:10}));assert.equal(contract.quantity,2);assert.equal(contract.risk,100);assert.equal(contract.reward,200);
});
test('manual quantity, lot steps, fixed risk and insufficient lots have explicit outcomes',()=>{
  const manual=calculatePosition(plan('long',{quantityMode:'manual',quantity:23.7,lotSize:.5}));assert.equal(manual.quantity,23.5);assert.equal(manual.exceedsRisk,true);
  const fixed=calculatePosition(plan('long',{riskMode:'amount',riskValue:75}));assert.equal(fixed.quantity,15);assert.equal(fixed.risk,75);
  const small=calculatePosition(plan('long',{riskMode:'amount',riskValue:1}));assert.equal(small.quantity,0);assert.equal(small.insufficientLot,true);assert.equal(small.risk,0);
  const fee=calculatePosition({...plan('long',{feeBps:1000}),target:100.01});assert.ok(fee.rewardPerUnit<0);assert.equal(fee.breakevenWinRate,null);
});
test('quantity precision rounds down and stays a multiple of the configured lot size',()=>{
  const whole=calculatePosition(plan('long',{lotSize:.001,quantityPrecision:0,feeBps:10}));assert.equal(whole.quantity,19);assert.ok(whole.risk<=whole.riskBudget);
  const fractional=calculatePosition(plan('long',{quantityMode:'manual',quantity:1,lotSize:.03,quantityPrecision:1}));close(fractional.quantity,.9);close(fractional.quantity/.03,30);
  const tiny=calculatePosition(plan('long',{quantityMode:'manual',quantity:.000001239,lotSize:1e-8,quantityPrecision:8}));close(tiny.quantity,.00000123);
});
test('invalid risk parameters, unsafe metadata, zero stops and inverted levels are rejected',()=>{
  for(const settings of [{leverage:0},{riskMode:'percent',riskValue:101},{lotSize:0},{feeBps:-1},{multiplier:Infinity},{showStats:'true'},{quantity:NaN},{unknown:1},JSON.parse('{"__proto__":{}}')])assert.throws(()=>positionSettings(settings));
  for(const change of [{stop:100},{stop:101},{target:99},{entry:0},{target:NaN}])assert.throws(()=>calculatePosition({...plan(),...change}));
  assert.equal(targetForRatio('long',100,95,3),115);assert.equal(targetForRatio('short',100,105,3),85);assert.throws(()=>targetForRatio('short',100,200,3));
});
test('shared position plans retain typed inputs and reject malformed plans atomically',()=>{
  const chart=new SharedCharts(':memory:');const principal={role:'editor',kind:'human'};
  const make=(revision,drawing,id)=>({baseRevision:revision,batchId:id,actor:{id:'test',name:'Test'},operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing}]});
  const drawing={id:'plan',name:'longPosition',points:[{timestamp:1000,value:100},{timestamp:2000,value:95},{timestamp:3000,value:110}],extendData:positionSettings({lotSize:1}),visible:true};
  try{
    const saved=chart.apply('main',make(0,drawing,'save'),principal);assert.equal(saved.state.drawings['BTCUSDT|1d'][0].extendData.accountSize,10000);
    for(const invalid of [{...drawing,extendData:{...drawing.extendData,accountSize:'secret'}},{...drawing,points:drawing.points.slice(0,2)},{...drawing,points:[drawing.points[0],{timestamp:2000,value:105},drawing.points[2]]}])assert.throws(()=>chart.apply('main',make(1,invalid,'bad'),principal));
    assert.equal(chart.get().revision,1);assert.throws(()=>chart.apply('main',make(1,drawing,'readonly'),{role:'reader'}),e=>e.status===403);
  }finally{chart.close();}
});
const bars=[10,12,14].map((close,index)=>({timestamp:1000+index*1000,open:close,low:close,high:close,close,volume:index===0?1:2}));
test('anchored VWAP uses actual volume, respects its start and excludes zero-volume warmup',()=>{
  const result=anchoredVwap(bars,1);assert.equal(result.length,2);assert.equal(result[0].value,12);assert.equal(result[1].value,13);
  assert.deepEqual(anchoredVwap(bars.map(b=>({...b,volume:0}))),[]);
  assert.equal(anchoredVwap([...bars.slice(0,1).map(b=>({...b,volume:0})),...bars.slice(1)])[0].timestamp,2000);
});
test('regression follows the supplied closes and volume-profile bins conserve total volume',()=>{
  const r=regressionChannel(bars);assert.equal(r.start,10);assert.equal(r.end,14);assert.equal(r.deviation,0);assert.equal(r.rSquared,1);
  const p=candleVolumeProfile([{low:10,high:12,close:11,volume:100},{low:11,high:11,close:11,volume:50}],2);
  close(p.bins.reduce((sum,b)=>sum+b.volume,0),150);assert.equal(p.total,150);assert.equal(p.poc,1);assert.ok(p.valueAreaVolume>=p.total*.7);assert.ok(p.val<=p.pocPrice&&p.pocPrice<=p.vah);
  assert.equal(candleVolumeProfile([{low:1,high:2,close:1,volume:0}]),null);assert.equal(regressionChannel(bars.slice(0,1)),null);
  assert.deepEqual(studyIndexRange(bars,[{timestamp:3000},{timestamp:1000}]),[0,2]);
});
