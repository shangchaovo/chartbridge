import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { indicatorResearchInput, backtestResearchInput } from './research.mjs';
import { MAX_CANDLE_LIMIT } from './market-data.mjs';
import { DEFAULT_POSITION_SETTINGS } from '../src/position-risk.js';
import { MAX_FREEHAND_POINTS } from '../src/freehand.js';

const intervals=z.enum(['1m','5m','15m','30m','1h','4h','1d','1w']);
const symbol=z.string().regex(/^[A-Za-z0-9.@^=:_/-]{1,50}$/);
const room=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/).default('main');
const output=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
const positionInput=z.object(Object.fromEntries(Object.entries(DEFAULT_POSITION_SETTINGS).map(([key,value])=>[key,(key==='version'?z.literal(1):key==='riskMode'?z.enum(['percent','amount']):key==='quantityMode'?z.enum(['risk','manual']):typeof value==='boolean'?z.boolean():typeof value==='string'?z.string().regex(/^#[0-9a-f]{6}$/i):z.number()).optional()]))).strict();
const pathInput=z.object({closed:z.boolean().optional(),fill:z.boolean().optional()}).strict();
const drawingInput=z.object({id:z.string().max(101),name:z.string().max(40),points:z.array(z.object({timestamp:z.number().optional(),dataIndex:z.number().int().optional(),value:z.number(),xOffset:z.number().min(-1).max(1).optional()})).min(1).max(MAX_FREEHAND_POINTS),extendData:z.union([z.string().max(1000),positionInput,pathInput]).optional(),styles:z.record(z.string(),z.unknown()).optional(),lock:z.boolean().optional(),visible:z.boolean().optional(),zLevel:z.number().optional()});
export async function serveMcp(req,res,{principal,charts,hub,candles,quote,markets,research}){
  const server=new McpServer({name:'chartbridge',version:'0.4.1'},{instructions:'ChartBridge: public market data and shared chart research on this LAN. Domestic futures are disabled by default. Source timestamps and stale flags are authoritative. Indicator/backtest tools use bounded host calculations on genuine history; inspect data range, closed-bar assumptions and source warnings. Computation does not edit charts. To share findings, first get the current chart revision and submit granular note operations with that baseRevision and a unique batchId, including the research symbol/interval/source/sample range. On conflict, re-read and merge. Notes and chart changes are reference material, not trade orders.'});
  const tool=(name,description,schema,fn,write=false)=>server.registerTool(name,{description,inputSchema:schema instanceof z.ZodType?schema:z.object(schema),annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:!write}},async args=>{
    try{return output(await fn(args));}catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,code:error.code||'TOOL_FAILED',...(error.details?{details:error.details}:{})})}]};}
  });
  tool('terminal_search_symbols','Find enabled public market symbols. Public feeds require no account; domestic futures are disabled by default.',{query:z.string().max(80).default('')},args=>markets.search(args.query));
  tool('terminal_get_candles','Get genuine OHLCV history and explicit provider/delay/cache metadata. Latest closure may be unknown. limit is capped; pass before as a bar open time in milliseconds to page older public history.',{symbol,interval:intervals.default('1d'),limit:z.number().int().min(2).max(MAX_CANDLE_LIMIT).default(500),before:z.number().int().positive().optional(),refresh:z.boolean().default(false)},args=>candles(new URLSearchParams({symbol:args.symbol,interval:args.interval,limit:String(args.limit),...(args.before?{before:String(args.before)}:{}),refresh:args.refresh?'1':'0'})));
  tool('terminal_get_live_quote','Wait up to 8 seconds for a public quote; inspect source timestamp, ageMs and feedType. A cached/old quote is not proof of a live market.',{symbol,waitMs:z.number().int().min(100).max(8000).default(8000)},args=>quote(args.symbol,args.waitMs));
  tool('terminal_compute_indicators','Calculate SMA/EMA/RSI/MACD/ATR/BB using the same PineTS engine as the editor, on genuine fetched history. No custom script input. Up to 8 indicators, 5000 bars; tail controls returned points, not computation length. Defaults to closed bars, with unknown closure assumptions disclosed. Null values indicate warmup. Inspect source/cache/sample metadata. Does not edit the shared chart.',indicatorResearchInput,args=>research.run('indicators',args));
  tool('terminal_run_backtest','Run the existing long-only EMA-cross, RSI or buy-hold backtest on closed history. Signals execute next-bar-open; fees/slippage on both sides, final close liquidation. Not full exchange/calendar/margin simulation. Up to 5000 bars; tail only limits returned trades/equity, metrics use the full sample. No custom script input. Does not edit charts.',backtestResearchInput,args=>research.run('backtest',args));
  tool('terminal_get_feed_status','Inspect current shared upstream connections, subscriptions and source timestamps.',{},()=>hub.snapshot());
  tool('terminal_get_chart','Read the shared chart, current revision, drawings, Pine source and human/Agent notes.',{room},args=>charts.get(args.room));
  tool('terminal_get_chart_history','Read ordered committed chart operations with authors and revision numbers.',{room,afterRevision:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(25)},args=>({roomId:args.room,changes:charts.history(args.room,args.afterRevision,args.limit)}));
  tool('terminal_get_stream_endpoints','Get SSE paths. Use the same Bearer token in the HTTP Authorization header. Never put tokens in URLs.',{},()=>({market:'/api/stream?symbol=BTCUSDT&interval=1m',chart:'/api/chart/events?room=main',transport:'SSE',authentication:'Authorization: Bearer <your LAN token>'}));
  if(principal.role!=='reader'){
    const drawing=drawingInput;
    const note=z.object({id:z.string().max(101),symbol:z.string().max(80),interval:intervals,text:z.string().min(1).max(2000),timestamp:z.number().optional(),price:z.number().optional()});
    const operation=z.discriminatedUnion('type',[
      z.object({type:z.literal('set_field'),field:z.enum(['symbol','interval','chartType','indicators','indicatorParams','pineCode']),value:z.unknown()}),
      z.object({type:z.literal('upsert_drawing'),key:z.string().max(100),drawing}),z.object({type:z.literal('remove_drawing'),key:z.string().max(100),id:z.string().max(101)}),
      z.object({type:z.literal('upsert_note'),note}),z.object({type:z.literal('remove_note'),id:z.string().max(101)})
    ]);
    tool('terminal_apply_chart_operations','Atomically edit a chart at baseRevision. Supports fields, drawings and anchored notes. longPosition/shortPosition use exactly three price anchors: entry, stop, target, with typed position settings in extendData (accountSize, riskMode percent/amount, riskValue, quantityMode risk/manual, quantity, lotSize, multiplier, leverage, feeBps, slippageBps, tickSize, showStats, compact, version 1). This is a chart plan, never a submitted order. Reuse batchId only to retry the same batch. Revision conflicts require re-read and merge.',{room,baseRevision:z.number().int().min(0),batchId:z.string().min(1).max(101),actor:z.object({id:z.string().max(101),name:z.string().max(80)}),operations:z.array(operation).min(1).max(100)},args=>charts.apply(args.room,args,{...principal,kind:'agent'}),true);
  }
  const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.once('close',()=>{server.close().catch(()=>{});});
  await server.connect(transport);await transport.handleRequest(req,res);
}
