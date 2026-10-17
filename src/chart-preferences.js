export const DEFAULT_CHART_PREFERENCES=Object.freeze({scale:'normal',grid:true,crosshair:true,lastPrice:true,reverse:false,watermark:true});
export function normalizeChartPreferences(value={}) {
  return {scale:['normal','log','percentage'].includes(value?.scale)?value.scale:'normal',
    ...Object.fromEntries(['grid','crosshair','lastPrice','reverse','watermark'].map(key=>[key,typeof value?.[key]==='boolean'?value[key]:DEFAULT_CHART_PREFERENCES[key]]))};
}
export function loadChartPreferences(storage) {
  try{return normalizeChartPreferences(JSON.parse(storage.getItem('shanhai-chart-preferences')||'{}'));}catch{return {...DEFAULT_CHART_PREFERENCES};}
}
