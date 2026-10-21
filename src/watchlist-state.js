export const WATCHLIST_STORAGE_KEY='shanhai-watchlist';
export const validWatchlist=value=>Array.isArray(value)&&value.length<=150&&value.every(symbol=>typeof symbol==='string'&&symbol.length>0&&symbol.length<=80&&!/[\x00-\x1f|]/.test(symbol));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Apply this tab's changes to the latest saved list, preserving independent edits.
export function mergeSavedWatchlist(base,next,current){
  if(![base,next,current].every(validWatchlist))throw new Error('自选列表无效或超过 150 个。');
  if(same(base,next))return [...current];
  const removed=new Set(base.filter(symbol=>!next.includes(symbol))),added=new Set(next.filter(symbol=>!base.includes(symbol)));
  const result=[...new Set([...next.filter(symbol=>current.includes(symbol)||added.has(symbol)),...current.filter(symbol=>!next.includes(symbol)&&!removed.has(symbol))])];
  if(result.length>150)throw new Error('自选列表合并后超过 150 个，请先移除部分品种。');
  return result;
}
export function readWatchlistBackup(storage){
  try{const value=JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY)||'null');return validWatchlist(value?.watchlist)?value:null;}catch{return null;}
}
export function writeWatchlistBackup(storage,watchlist,{pending=false,base}={}){
  if(!validWatchlist(watchlist))return false;
  try{storage.setItem(WATCHLIST_STORAGE_KEY,JSON.stringify({watchlist:[...watchlist],pending,...(validWatchlist(base)?{base:[...base]}:{})}));return true;}catch{return false;}
}
