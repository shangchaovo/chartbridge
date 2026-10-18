import { validTimezone } from './chart-time.js';
export const DEFAULT_CHART_PREFERENCES=Object.freeze({scale:'normal',grid:true,crosshair:true,lastPrice:true,lastPriceLine:true,countdown:true,timezone:'Asia/Shanghai',reverse:false,watermark:true});
export function normalizeChartPreferences(value={}) {
  return {scale:['normal','log','percentage'].includes(value?.scale)?value.scale:'normal',timezone:value?.timezone==='exchange'||validTimezone(value?.timezone)?value.timezone:DEFAULT_CHART_PREFERENCES.timezone,
    ...Object.fromEntries(['grid','crosshair','lastPrice','lastPriceLine','countdown','reverse','watermark'].map(key=>[key,typeof value?.[key]==='boolean'?value[key]:DEFAULT_CHART_PREFERENCES[key]]))};
}
export function loadChartPreferences(storage) {
  try{return normalizeChartPreferences(JSON.parse(storage.getItem('shanhai-chart-preferences')||'{}'));}catch{return {...DEFAULT_CHART_PREFERENCES};}
}
