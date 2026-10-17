export const CHART_FIELDS = ['symbol','interval','chartType','indicators','indicatorParams','pineCode'];
const clone = value => structuredClone(value);
const stable = value => value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().filter(k=>!['author','updatedAt'].includes(k)).map(k=>[k,stable(value[k])])):value;
const same = (a,b) => JSON.stringify(stable(a))===JSON.stringify(stable(b));

export function chartStateFromWorkspace(value={}) {
  const state = {symbol:'BTCUSDT',interval:'1d',chartType:'candle_solid',indicators:['EMA','VOL'],indicatorParams:{EMA:[12,26]},pineCode:'//@version=6\nindicator("Close", overlay=true)\nplot(close)'};
  for (const key of CHART_FIELDS) if (value[key]!==undefined) state[key]=clone(value[key]);
  state.drawings=clone(value.drawings||{});state.notes=clone(value.notes||{});
  return state;
}

export function diffChartStates(base, next) {
  const operations=[];
  for(const field of CHART_FIELDS) if(!same(base[field],next[field])) operations.push({type:'set_field',field,value:clone(next[field])});
  for(const key of new Set([...Object.keys(base.drawings||{}),...Object.keys(next.drawings||{})])){
    const before=new Map((base.drawings?.[key]||[]).map(d=>[d.id,d]));
    const after=new Map((next.drawings?.[key]||[]).map(d=>[d.id,d]));
    for(const [id,drawing] of after)if(!same(before.get(id),drawing))operations.push({type:'upsert_drawing',key,drawing:clone(drawing)});
    for(const id of before.keys())if(!after.has(id))operations.push({type:'remove_drawing',key,id});
  }
  for(const id of Object.keys(next.notes||{}))if(!same(base.notes?.[id],next.notes[id]))operations.push({type:'upsert_note',note:clone(next.notes[id])});
  for(const id of Object.keys(base.notes||{}))if(!next.notes?.[id])operations.push({type:'remove_note',id});
  return operations;
}

// Merge at field / drawing ID / note ID boundaries. A conflict keeps the local
// draft visible and blocks publication until the human explicitly resolves it.
export function mergeChartStates(base, local, remote) {
  const merged=clone(remote),conflicts=[];
  function choose(path,b,l,r){
    if(same(l,b))return clone(r);
    if(same(l,r))return clone(r);
    if(!same(r,b)&&!same(l,r))conflicts.push(path);
    return l===undefined?undefined:clone(l);
  }
  for(const field of CHART_FIELDS)merged[field]=choose(field,base[field],local[field],remote[field]);
  merged.drawings={};
  for(const key of new Set([...Object.keys(base.drawings||{}),...Object.keys(local.drawings||{}),...Object.keys(remote.drawings||{})])){
    const maps=[base,local,remote].map(v=>new Map((v.drawings?.[key]||[]).map(d=>[d.id,d])));
    const output=[];
    for(const id of new Set(maps.flatMap(map=>[...map.keys()]))){const value=choose(`drawings/${key}/${id}`,...maps.map(map=>map.get(id)));if(value!==undefined)output.push(value);}
    if(output.length)merged.drawings[key]=output;
  }
  merged.notes={};
  for(const id of new Set([base,local,remote].flatMap(v=>Object.keys(v.notes||{})))){
    const value=choose(`notes/${id}`,base.notes?.[id],local.notes?.[id],remote.notes?.[id]);if(value!==undefined)merged.notes[id]=value;
  }
  return {state:merged,conflicts};
}
