// Explicit maintenance command. The app itself loads only checked-in local assets.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SYMBOL_CATALOG} from '../server/market-data.mjs';
import {FUTURES_CATALOG} from '../server/public-feeds.mjs';
const root=new URL('../src/assets/logos/',import.meta.url);await mkdir(root,{recursive:true});
const rows=[...SYMBOL_CATALOG,...FUTURES_CATALOG],bySymbol=new Map(rows.map(row=>[row.symbol,row]));
const extraStocks={HOOD:'NASDAQ',CRCL:'NYSE'};
const stockRows=[...rows.filter(x=>['us','cn','hk'].includes(x.market)),...Object.entries(extraStocks).map(([symbol,exchange])=>({symbol,exchange,market:'us'}))];
const stockTicker=row=>row.market==='hk'?`HKEX:${Number(row.symbol.split('.')[0])}`:row.market==='cn'?`${row.exchange}:${row.symbol.split('.')[0]}`:`${row.exchange==='NYSE ARCA'?'AMEX':row.exchange}:${row.symbol}`;
const aliases=new Map();
for(const row of stockRows)aliases.set(row.symbol,stockTicker(row));
// Scanner uses current listing venues and dots for the share class.
aliases.set('WMT','NASDAQ:WMT');aliases.set('BRK-B','NYSE:BRK.B');
for(const row of rows.filter(x=>x.market==='crypto')){
 const code=row.symbol.replace(/^(OKX|KRAKEN):/,'').replace(/[-/]/g,'');aliases.set(row.symbol,`${row.exchange}:${code}`);
}
for(const row of rows.filter(x=>x.type==='perpetual')){const base=row.symbol.replace(/^BINANCE:/,'').replace(/USDT$/,'');const stock=stockRows.find(x=>x.symbol===base);if(stock)aliases.set(row.symbol,stockTicker(stock));}
const indices={'^GSPC':'SP:SPX','^IXIC':'NASDAQ:IXIC','^DJI':'DJ:DJI','^HSI':'HSI:HSI','000001.SS':'SSE:000001','399001.SZ':'SZSE:399001','000300.SS':'SSE:000300','000016.SS':'SSE:000016','000905.SS':'SSE:000905','000688.SS':'SSE:000688','399006.SZ':'SZSE:399006','^HSCE':'HSI:HSCEI','^NDX':'NASDAQ:NDX','^VIX':'CBOE:VIX','^FTSE':'FTSE:UKX','^GDAXI':'XETR:DAX','^FCHI':'EURONEXT:PX1','^N225':'TVC:NI225','^KS11':'KRX:KOSPI','^TWII':'TWSE:TAIEX','^AXJO':'ASX:XJO'};
for(const [symbol,ticker]of Object.entries(indices))aliases.set(symbol,ticker);
const tickers=[...new Set(aliases.values())],metadata=new Map();
for(let i=0;i<tickers.length;i+=80){
 const res=await fetch('https://scanner.tradingview.com/global/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:{tickers:tickers.slice(i,i+80),query:{types:[]}},columns:['name','logoid','base_currency_logoid','currency_logoid']}),signal:AbortSignal.timeout(25000)});
 if(!res.ok)throw new Error(`Public symbol metadata: HTTP ${res.status}`);
 const result=await res.json();for(const record of result.data||[])metadata.set(record.s,{ticker:record.s,logo:record.d[1]||record.d[2]||null});
}
const logos={},sources=[],failures=[];
const unique=[...new Set([...metadata.values()].map(x=>x.logo).filter(Boolean))];
let next=0;const files=new Map();
await Promise.all(Array.from({length:6},async()=>{while(next<unique.length){const logo=unique[next++];const url=`https://s3-symbol-logo.tradingview.com/${logo}--big.svg`;
 try{
  const res=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const svg=await res.text();if(svg.length>300000||!/<svg\b/i.test(svg)||/<(?:script|foreignObject)\b|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)|\bon\w+\s*=/i.test(svg))throw new Error('Unexpected SVG content');
  const file=`tv-${createHash('sha256').update(logo).digest('hex').slice(0,16)}.svg`;await writeFile(new URL(file,root),svg);files.set(logo,file);sources.push({logo,file,url,sha256:createHash('sha256').update(svg).digest('hex')});
 }catch(e){failures.push({logo,error:e.message});}
}}));
for(const [symbol,ticker]of aliases){const m=metadata.get(ticker);if(m?.logo&&files.has(m.logo))logos[symbol]=files.get(m.logo);}
const identities=Object.fromEntries([...bySymbol].map(([symbol,row])=>[symbol,{name:row.name,market:row.market,type:row.type}]));
const sorted=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
await writeFile(new URL('../src/symbol-logo-catalog.js',import.meta.url),`// Public symbol metadata fetched by scripts/sync-symbol-logos.mjs. Runtime is offline.\nexport const SYMBOL_LOGOS=${JSON.stringify(sorted(logos),null,2)};\nexport const SYMBOL_IDENTITIES=${JSON.stringify(sorted(identities),null,2)};\n`);
await writeFile(new URL('sources.json',root),JSON.stringify({retrievedAt:new Date().toISOString(),metadataSource:'https://scanner.tradingview.com/global/scan',symbols:sorted(Object.fromEntries([...aliases].map(([symbol,ticker])=>[symbol,{ticker,logo:metadata.get(ticker)?.logo||null,file:logos[symbol]||null}]))),assets:sources.sort((a,b)=>a.logo.localeCompare(b.logo)),failures},null,2));
console.log(JSON.stringify({catalog:rows.length,mappedSymbols:Object.keys(logos).length,assets:files.size,failures},null,2));
