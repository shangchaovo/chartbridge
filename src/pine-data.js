const intervals={'1':'1m','5':'5m','15':'15m','30':'30m','60':'1h','240':'4h','D':'1d','1D':'1d','W':'1w','1W':'1w'};
export const intervalMs={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
const error=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function canonicalSymbol(input,current=''){
  const native=String(input||current);if(/^TQ:(?:KQ\.[mi]@)?(?:SHFE|DCE|CZCE|CFFEX|INE|GFEX)\.[A-Za-z]{1,6}\d{0,4}$/.test(native))return native;
  const value=String(input||current).toUpperCase();if(!value.includes(':'))return value;
  const [prefix,ticker,...extra]=value.split(':');if(extra.length)error('DATA_UNAVAILABLE','不支持该交易所代码格式。');
  if(prefix==='BINANCE'&&/^[A-Z0-9]+(?:USDT|USDC|FDUSD)$/.test(ticker))return ticker;
  if(prefix==='SINA'&&/^[A-Z]{1,3}\d{1,4}$/.test(ticker))return value;
  if(['SSE','SHSE'].includes(prefix)&&/^\d{6}$/.test(ticker))return `${ticker}.SS`;
  if(prefix==='SZSE'&&/^\d{6}$/.test(ticker))return `${ticker}.SZ`;
  if(prefix==='HKEX'&&/^\d{4,5}$/.test(ticker))return `${String(Number(ticker)).padStart(4,'0')}.HK`;
  if(prefix==='NASDAQ'&&['AAPL','NVDA','MSFT','TSLA','AMZN','GOOGL','META','AMD','QQQ'].includes(ticker))return ticker;
  if(['AMEX','NYSEARCA'].includes(prefix)&&ticker==='SPY')return ticker;
  error('DATA_UNAVAILABLE',`尚未验证交易所代码 ${prefix}:${ticker} 的数据映射；请使用行情目录中的完整代码。`);
}
function masked(code){return code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,token=>token.replace(/[^\n]/g,' '));}
function literal(source,kind,current){
  const text=source?.trim();if(kind==='symbol'&&/^syminfo\s*\.\s*tickerid$/.test(text))return current;
  if(kind==='timeframe'&&/^timeframe\s*\.\s*period$/.test(text))return current;
  if(!/^"(?:\\.|[^"\\])*"$|^'(?:\\.|[^'\\])*'$/.test(text||''))error(kind==='symbol'?'DYNAMIC_SYMBOL_UNSUPPORTED':'DYNAMIC_TIMEFRAME_UNSUPPORTED',`request.security 的 ${kind} 当前需要字符串常量、syminfo.tickerid 或 timeframe.period。`);
  const value=text.slice(1,-1);if(value.includes('\\'))error('DYNAMIC_SYMBOL_UNSUPPORTED','行情代码与周期不能包含转义字符。');return value||current;
}
export function collectPineRequests(code,symbol,interval){
  interval=intervals[interval]||interval;
  const source=masked(code),requests=[],current=canonicalSymbol(symbol),matches=source.matchAll(/\brequest\s*\.\s*(security|security_lower_tf)\s*\(/g);
  for(const match of matches){
    if(match[1]!=='security')error('LOWER_TIMEFRAME_UNSUPPORTED','security_lower_tf 的逐笔数组语义尚未接入。');
    let depth=1,start=match.index+match[0].length,last=start,args=[];
    for(let i=start;i<source.length;i++){
      const ch=source[i];if('([{'.includes(ch))depth++;if(')]}'.includes(ch))depth--;
      if(depth===1&&ch===','){args.push(code.slice(last,i));last=i+1;}if(depth===0){args.push(code.slice(last,i));break;}
    }
    const named={},positional=[];for(const arg of args){const key=arg.match(/^\s*([a-z_]+)\s*=\s*(?!=)/);if(key)named[key[1]]=arg.slice(key[0].length);else positional.push(arg);}
    const rawSymbol=literal(named.symbol??positional[0],'symbol',symbol),rawTimeframe=literal(named.timeframe??positional[1],'timeframe',interval);
    const requestedSymbol=canonicalSymbol(rawSymbol,current),requestedInterval=intervals[rawTimeframe]||(['1m','5m','15m','30m','1h','4h','1d','1w'].includes(rawTimeframe)?rawTimeframe:null);
    if(!requestedInterval)error('UNSUPPORTED_REQUEST_TIMEFRAME',`request.security 周期 ${rawTimeframe} 尚未接入对应数据源。`);
    const lookahead=named.lookahead??positional[4];if(lookahead!==undefined&&lookahead.trim()!=='barmerge.lookahead_off')error('LOOKAHEAD_UNSUPPORTED','本地多周期研究仅接受默认 lookahead_off，避免将未来高周期收盘值提前使用。');
    if(intervalMs[requestedInterval]<intervalMs[interval])error('LOWER_TIMEFRAME_UNSUPPORTED','低周期 request.security 尚未接入；当前支持同周期与更高周期。');
    requests.push({symbol:requestedSymbol,interval:requestedInterval,requestedSymbol:rawSymbol,requestedTimeframe:rawTimeframe});
  }
  const unique=[...new Map(requests.map(r=>[`${r.symbol}|${r.interval}`,r])).values()];if(unique.length>8)error('TOO_MANY_DATASETS','每次最多请求 8 个不同标的/周期组合。');return unique;
}
