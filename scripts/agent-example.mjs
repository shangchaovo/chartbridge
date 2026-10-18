// Node 18+; run this on another LAN computer. No package installation needed.
import { randomUUID } from 'node:crypto';
const base=process.env.CHARTBRIDGE_URL||process.env.SHANHAI_URL;
const token=process.env.CHARTBRIDGE_TOKEN||process.env.SHANHAI_TOKEN;
if(!base||!token){console.error('Set CHARTBRIDGE_URL to the host URL and CHARTBRIDGE_TOKEN to its reader/editor token. Legacy SHANHAI_URL / SHANHAI_TOKEN are also supported.');process.exit(1);}
const url=new URL('/mcp',base);let requestId=0;
async function rpc(method,params){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25',Authorization:`Bearer ${token}`},body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params}),signal:AbortSignal.timeout(30000)});
  const payload=await response.json();if(!response.ok||payload.error)throw new Error(payload.error?.message||payload.error||`HTTP ${response.status}`);return payload.result;
}
async function tool(name,args={}){const result=await rpc('tools/call',{name,arguments:args});if(result.isError)throw new Error(result.content?.[0]?.text||'Tool failed');return result.structuredContent;}
await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'chartbridge-lan-example',version:'0.4.1'}});
const chart=await tool('terminal_get_chart',{room:'main'});
const quote=await tool('terminal_get_live_quote',{symbol:chart.state.symbol,waitMs:8000});
console.log(JSON.stringify({room:chart.roomId,revision:chart.revision,symbol:chart.state.symbol,interval:chart.state.interval,quote},null,2));
const noteIndex=process.argv.indexOf('--note');
const researchIndex=process.argv.indexOf('--research'),shareResearch=process.argv.includes('--share-research');
let research;
if(researchIndex>=0||shareResearch){
  const kind=researchIndex>=0&&process.argv[researchIndex+1]&&!process.argv[researchIndex+1].startsWith('--')?process.argv[researchIndex+1]:'indicators';
  if(!['indicators','backtest'].includes(kind))throw new Error('--research accepts indicators or backtest');
  research=await tool(kind==='indicators'?'terminal_compute_indicators':'terminal_run_backtest',{symbol:chart.state.symbol,interval:chart.state.interval,limit:800,tail:5});
  console.log(JSON.stringify(research,null,2));
}
if(noteIndex>=0||shareResearch){
  const text=noteIndex>=0?process.argv[noteIndex+1]:null;if(noteIndex>=0&&(!text||text.startsWith('--')))throw new Error('--note requires text');
  // Fetch again after waiting for a quote. A conflict is returned to the caller;
  // the example never force-writes over another person's newer revision.
  const current=await tool('terminal_get_chart',{room:'main'});
  if(current.state.symbol!==chart.state.symbol||current.state.interval!==chart.state.interval)throw new Error('Chart view changed while reading quotes. Re-run to use the current symbol/timeframe.');
  const notes=[];
  if(text)notes.push({id:randomUUID(),symbol:current.state.symbol,interval:current.state.interval,text,...(quote.quote?.timestamp?{timestamp:quote.quote.timestamp}:{}),...(Number.isFinite(quote.quote?.price)?{price:quote.quote.price}:{})});
  if(shareResearch){
    const data=research.data,summary=research.kind==='indicators'?research.series.map(s=>`${s.name}: ${s.latest?.value??'null (warmup)'}`).join('\n'):`${research.options.strategy}: return ${(research.metrics.totalReturn*100).toFixed(2)}%, max drawdown ${(research.metrics.maxDrawdown*100).toFixed(2)}%, trades ${research.metrics.tradeCount}`;
    const details=[`Agent ${research.kind}: ${data.symbol} ${data.interval}`,summary,`${data.usedBars} bars; ${new Date(data.from).toISOString()} — ${new Date(data.to).toISOString()}`,`Source: ${data.source.providerName||data.source.provider}; cache: ${data.source.cache}; assumed closed: ${data.assumedClosedBars}; SHA256: ${data.sha256}`,...research.warnings].join('\n').slice(0,2000);
    notes.push({id:randomUUID(),symbol:data.symbol,interval:data.interval,text:details,timestamp:data.to,price:data.lastClose});
  }
  const result=await tool('terminal_apply_chart_operations',{room:'main',baseRevision:current.revision,batchId:randomUUID(),actor:{id:'lan-example-agent',name:'局域网 Agent'},operations:notes.map(note=>({type:'upsert_note',note}))});
  console.log(JSON.stringify({committedRevision:result.revision}));
}
