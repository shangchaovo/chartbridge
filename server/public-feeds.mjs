// Public web feeds also used by AKShare. Parse data as data; never execute JSONP.
export const FUTURES_CATALOG = [
  ['RB0','螺纹钢连续','SHFE'],['AU0','黄金连续','SHFE'],['AG0','白银连续','SHFE'],
  ['CU0','沪铜连续','SHFE'],['AL0','沪铝连续','SHFE'],['SC0','原油连续','INE'],
  ['M0','豆粕连续','DCE'],['I0','铁矿石连续','DCE'],['P0','棕榈油连续','DCE'],
  ['SR0','白糖连续','CZCE'],['CF0','棉花连续','CZCE'],['TA0','PTA连续','CZCE'],
  ['LC0','碳酸锂连续','GFEX'],['IF0','沪深300股指连续','CFFEX'],['IC0','中证500股指连续','CFFEX'],
  ['IM0','中证1000股指连续','CFFEX'],['T0','十年国债连续','CFFEX'],
].map(([code,name,exchange])=>({symbol:`SINA:${code}`,name,market:'cn-futures',exchange,currency:'CNY',type:'futures',provider:'sina'}));
export const isDomesticFuture = symbol => /^SINA:[A-Z]{1,3}\d{1,4}$/.test(symbol);
export function sinaCode(symbol) {
  if(isDomesticFuture(symbol))return `nf_${symbol.slice(5)}`;
  if(/^\d{6}\.SS$/.test(symbol))return `sh${symbol.slice(0,6)}`;
  if(/^\d{6}\.SZ$/.test(symbol))return `sz${symbol.slice(0,6)}`;
  if(/^\d{4,5}\.HK$/.test(symbol))return `rt_hk${symbol.split('.')[0].padStart(5,'0')}`;
  if(/^[A-Z]{1,6}$/.test(symbol))return `gb_${symbol.toLowerCase()}`;
  return ({'EURUSD=X':'fx_seurusd','GBPUSD=X':'fx_sgbpusd','JPY=X':'fx_susdjpy','AUDUSD=X':'fx_saudusd','CNY=X':'fx_susdcny','CHF=X':'fx_susdchf',
    'GC=F':'hf_GC','CL=F':'hf_CL','SI=F':'hf_SI','HG=F':'hf_HG',
    '^GSPC':'int_sp500','^DJI':'int_dji','^IXIC':'int_nasdaq'})[symbol]||null;
}
// hf_/gb_ 的报价时间在交易所时区（实测美东），纯标准库做 DST 判定（3月第2个周日07:00UTC 至 11月第1个周日06:00UTC 为 EDT=-4，其余 EST=-5）。
export function easternOffsetMinutes(utcMillis) {
  const year=new Date(utcMillis).getUTCFullYear();
  const firstDayOfMonth=m=>Date.UTC(year,m,1);
  const nthSunday=(month,n)=>{const d=new Date(firstDayOfMonth(month));const dow=d.getUTCDay();return firstDayOfMonth(month)+((7-dow)%7+7*(n-1))*86400000;};
  return (utcMillis>=nthSunday(2,2)+7*3600000&&utcMillis<nthSunday(10,1)+6*3600000)?-240:-300;
}
// 'Oct 16 07:59PM EDT' -> UTC ms；无时区后缀返回 null。
export function parseUsMarkerTimestamp(text){
  const m=/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EDT|EST)$/.exec(String(text||'').trim());
  if(!m)return null;
  const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const month=months[m[1]],day=Number(m[2]);let hour=Number(m[3]);const minute=Number(m[4]);
  if(month===undefined||!day)return null;
  const isPM=m[5]==='PM';if(isPM&&hour!==12)hour+=12;if(!isPM&&hour===12)hour=0;
  const guessed=Date.UTC(new Date().getUTCFullYear(),month,day,hour,minute);
  const offset=easternOffsetMinutes(guessed);
  return guessed-offset*60000;
}
const value = v => v!==''&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
const stamp = (day,time='00:00:00') => {
  if(!day||!/^\d{4}[-/]\d\d[-/]\d\d$/.test(day))return null;
  const t=String(time).replace(/^(\d{2})(\d{2})(\d{2})$/,'$1:$2:$3');
  if(!/^\d\d:\d\d:\d\d$/.test(t))return null;
  const n=Date.parse(`${day.replaceAll('/','-')}T${t}+08:00`);return Number.isFinite(n)?n:null;
};
export function parseSinaQuotes(text,symbols,receivedAt=Date.now()) {
  const records=new Map();
  for(const m of text.matchAll(/(?:^|\n)\s*var\s+hq_str_([A-Za-z0-9_]+)\s*=\s*"([^"\r\n]*)"\s*;/g))records.set(m[1],m[2].split(','));
  const output=[];
  for(const symbol of symbols){
    const code=sinaCode(symbol),a=records.get(code);if(!a?.length)continue;
    let price,previousClose,timestamp,volume,open,high,low,name,change,changePercent,reference='previous-close';
    if(code.startsWith('nf_')){
      const financial=/^nf_(IF|IC|IH|IM|T|TF|TS|TL)\d/.test(code);
      if(financial){[open,high,low,price]=a.slice(0,4).map(value);previousClose=value(a[13]);volume=value(a[4]);timestamp=stamp(a[36],a[37]);name=a[49]||symbol;reference='previous-settlement';}
      else{open=value(a[2]);high=value(a[3]);low=value(a[4]);price=value(a[8]);previousClose=value(a[10]);volume=value(a[14]);timestamp=stamp(a[17],a[1]);name=a[0];reference='previous-settlement';}
    }else if(code.startsWith('rt_hk')){name=a[1];open=value(a[2]);previousClose=value(a[3]);high=value(a[4]);low=value(a[5]);price=value(a[6]);volume=value(a[12]);timestamp=stamp(a[17],a[18]);}
    else if(code.startsWith('gb_')){
      // 新浪美股：[0]名称 [1]最新 [2]涨跌% [3]新浪取数时间(北京) [4]涨跌额 [5]开 [6]高 [7]低 [10]量 [25]美东报价标记 [26]美东收盘 [27]昨收
      name=a[0];price=value(a[1]);change=value(a[4]);previousClose=value(a[26]);
      open=value(a[5]);high=value(a[6]);low=value(a[7]);volume=value(a[10]);
      changePercent=value(a[2]);const marker=parseUsMarkerTimestamp(a[24]);timestamp=marker??stamp(a[3]);
      reference='previous-close';
    }
    else if(code.startsWith('hf_')){
      // 新浪国际期货：[0]最新 [2]买 [3]卖 [4]高 [5]低 [6]时间(市场时区秒) [7]昨结 [8]开 [12]日期 [13]名称
      name=a[13];price=value(a[0]);high=value(a[4]);low=value(a[5]);open=value(a[8]);previousClose=value(a[7]);volume=null;
      const mDay=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a[12]||'')),mHms=/^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(a[6]||''));
      if(mDay&&mHms){const guess=Date.UTC(+mDay[1],+mDay[2]-1,+mDay[3],+mHms[1],+mHms[2],+mHms[3]);timestamp=guess-easternOffsetMinutes(guess)*60000;}
      reference='previous-settlement';
    }
    else if(code.startsWith('int_')){
      // 新浪全球指数：[0]名称 [1]最新 [2]涨跌额 [3]涨跌%——没有时间戳，用本机请求时间标记并如实披露
      name=a[0];price=value(a[1]);change=value(a[2]);changePercent=value(a[3]);timestamp=receivedAt;
      open=null;high=null;low=null;volume=null;reference='previous-close-marked-at-fetch';
    }
    else if(code.startsWith('fx_')){name=a[9];price=value(a[8]);previousClose=value(a[3]);open=value(a[5]);high=value(a[6]);low=value(a[7]);timestamp=stamp(a[17],a[0]);volume=null;}
    else{name=a[0];open=value(a[1]);previousClose=value(a[2]);price=value(a[3]);high=value(a[4]);low=value(a[5]);volume=value(a[8]);timestamp=stamp(a[30],a[31]);}
    if(price===null||price<=0||timestamp===null)continue;
    const resolvedChange=change!==null&&change!==undefined?change:(previousClose>0?price-previousClose:null);
    const resolvedPercent=changePercent!==null&&changePercent!==undefined?changePercent:(resolvedChange===null||!(previousClose>0)?null:resolvedChange/previousClose*100);
    output.push({symbol,quote:{price,previousClose,change:resolvedChange,changePercent:resolvedPercent,timestamp,volume,open,high,low,changeReference:reference},
      meta:{provider:'sina',providerName:'新浪公开网页行情',sourceUrl:`https://hq.sinajs.cn/list=${code}`,name,feedType:'poll',pollIntervalMs:3000,delayMinutes:null,delayVerified:false,sourceTime:timestamp,receivedAt,ageMs:Math.max(0,receivedAt-timestamp),priceBasis:'unadjusted',warnings:['公开网页报价按 3 秒轮询；源时间反映报价新鲜度，无法据此保证交易所至网页全链路零延迟。',...(isDomesticFuture(symbol)&&/0$/.test(symbol)?['连续代码可能换月；不是固定交割合约。']:[])]}});
  }
  return output;
}
async function textFetch(url){
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 Shanhai/0.2','Referer':'https://vip.stock.finance.sina.com.cn/'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Object.assign(new Error(`新浪公开行情返回 HTTP ${response.status}。`),{status:502,code:'UPSTREAM_HTTP_ERROR'});
  return new TextDecoder('gb18030').decode(await response.arrayBuffer());
}
export async function fetchPublicQuotes(symbols){
  const supported=[...new Set(symbols.filter(s=>sinaCode(s)))];if(!supported.length)return [];
  // Sina's legacy handler consumes everything after list= as symbols, even in
  // a query string. Keep the cache buster first and list= last (AKShare format).
  const text=await textFetch(`https://hq.sinajs.cn/rn=${Date.now()}&list=${supported.map(sinaCode).join(',')}`);
  return parseSinaQuotes(text,supported);
}
export function parseJsonp(text){
  const trimmed=text.trim();if(trimmed.startsWith('['))return JSON.parse(trimmed);
  const start=text.indexOf('=('),end=text.lastIndexOf(');');
  if(start<0||end<start)throw Object.assign(new Error('新浪 K 线格式发生变化。'),{code:'INVALID_UPSTREAM_RESPONSE'});
  return JSON.parse(text.slice(start+2,end));
}
export async function fetchSinaCandles(symbol,interval,limit){
  const domestic=isDomesticFuture(symbol),stock=/^\d{6}\.(SS|SZ)$/.test(symbol),period={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'1d':240}[interval];
  if((!domestic&&!stock)||!period)throw Object.assign(new Error('新浪此源支持 1/5/15/30 分钟、1 小时和日线；请切换周期。'),{status:422,code:'UNSUPPORTED_INTERVAL'});
  const sourceUrl=domestic
    ?`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/=/InnerFuturesNewService.${interval==='1d'?'getDailyKLine':'getFewMinLine'}?${new URLSearchParams({symbol:symbol.slice(5),type:String(period)})}`
    :`https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_k=/CN_MarketDataService.getKLineData?${new URLSearchParams({symbol:sinaCode(symbol),scale:String(period),ma:'no',datalen:String(Math.min(1023,limit))})}`;
  const raw=parseJsonp(await textFetch(sourceUrl));if(!Array.isArray(raw))throw Object.assign(new Error('新浪未返回有效 K 线。'),{status:404,code:'NO_DATA'});
  const candles=raw.map(row=>{
    const date=String(row.d||row.day||'').split(' '),timestamp=stamp(date[0],date[1]);
    return {timestamp,open:value(row.o??row.open),high:value(row.h??row.high),low:value(row.l??row.low),close:value(row.c??row.close),volume:value(row.v??row.volume)};
  }).filter(b=>['timestamp','open','high','low','close','volume'].every(k=>Number.isFinite(b[k]))&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.volume>=0);
  const sorted=[...new Map(candles.map(b=>[b.timestamp,b])).values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-limit);
  if(!sorted.length)throw Object.assign(new Error('新浪未返回有效 K 线。'),{status:404,code:'NO_DATA'});
  const entry=FUTURES_CATALOG.find(v=>v.symbol===symbol),last=sorted.at(-1);
  let current;try{[current]=await fetchPublicQuotes([symbol]);}catch{/* Valid history remains available when the independent quote feed fails. */}
  return {symbol,interval,candles:sorted,quote:current?.quote||{price:last.close,timestamp:last.timestamp,change:null,changePercent:null,volume:last.volume},
    meta:{provider:'sina',providerName:'新浪公开 K 线',sourceUrl,exchange:entry?.exchange||(symbol.endsWith('.SS')?'SSE':'SZSE'),currency:'CNY',name:entry?.name||current?.meta.name||symbol,timezone:'Asia/Shanghai',delayMinutes:null,feedType:'snapshot',priceBasis:'unadjusted',fetchedAt:Date.now(),sourceTime:current?.quote.timestamp||last.timestamp,lastBarClosed:null,timestampConvention:'source-labeled',warnings:['公开网页 K 线的最近一根收盘状态未确认；日线接口可能仅包含上一交易日及以前数据。',...(domestic?['期货连续序列按源代码换月；未处理换月价差、乘数和保证金。']:[])]}};
}
