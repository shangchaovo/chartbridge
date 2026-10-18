import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {serveMcp} from '../server/mcp.mjs';
import {SharedCharts} from '../server/shared-charts.mjs';

test('MCP publishes and accepts typed position plans while backend rejects invalid price order',async()=>{
 const charts=new SharedCharts(':memory:');const server=createServer((req,res)=>serveMcp(req,res,{principal:{role:'editor'},charts}).catch(e=>{res.statusCode=500;res.end(e.message);}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/mcp`;
 const call=async(method,params)=>{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(response.status,200);return (await response.json()).result;};
 try{
  const list=await call('tools/list',{});assert.ok(list.tools.some(t=>t.name==='terminal_apply_chart_operations'));
  const drawing={id:'mcp-position',name:'longPosition',points:[{timestamp:1000,value:100},{timestamp:2000,value:95},{timestamp:3000,value:110}],extendData:{accountSize:10000,riskMode:'percent',riskValue:1,lotSize:1,feeBps:5,showStats:true,targetColor:'#00796b',alwaysShowStats:false},visible:false};
  const args={room:'main',baseRevision:0,batchId:'mcp-position-save',actor:{id:'qa',name:'QA'},operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing}]};
  const saved=await call('tools/call',{name:'terminal_apply_chart_operations',arguments:args});assert.notEqual(saved.isError,true);const plan=charts.get().state.drawings['BTCUSDT|1d'][0];assert.equal(plan.extendData.feeBps,5);assert.equal(plan.visible,false);
  const invalid={...args,baseRevision:1,batchId:'bad-position',operations:[{...args.operations[0],drawing:{...drawing,points:[drawing.points[0],{timestamp:2000,value:105},drawing.points[2]]}}]};
  const rejected=await call('tools/call',{name:'terminal_apply_chart_operations',arguments:invalid});assert.equal(rejected.isError,true);assert.equal(charts.get().revision,1);
 }finally{charts.close();await new Promise(resolve=>server.close(resolve));}
});
