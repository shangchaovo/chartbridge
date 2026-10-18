export const CHART_TIMEZONES=Object.freeze([
  ['exchange','交易所时区'],['UTC','UTC'],['Asia/Shanghai','上海 · UTC+8'],['Asia/Hong_Kong','香港 · UTC+8'],['Asia/Tokyo','东京 · UTC+9'],['Asia/Singapore','新加坡 · UTC+8'],['Asia/Kolkata','加尔各答 · UTC+5:30'],['Asia/Dubai','迪拜 · UTC+4'],['Europe/London','伦敦'],['Europe/Berlin','柏林'],['America/New_York','纽约'],['America/Chicago','芝加哥'],['America/Los_Angeles','洛杉矶'],['Australia/Sydney','悉尼'],
]);
export function validTimezone(value){try{if(typeof value!=='string'||!value)return false;new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
export function chartTimezone(preference,exchange){return preference==='exchange'?(validTimezone(exchange)?exchange:'UTC'):(validTimezone(preference)?preference:'Asia/Shanghai');}
export function timezoneLabel(timeZone,now=Date.now()){
  const offset=new Intl.DateTimeFormat('en',{timeZone,timeZoneName:'shortOffset'}).formatToParts(now).find(p=>p.type==='timeZoneName')?.value?.replace('GMT','UTC')||'UTC';
  return `${timeZone} · ${offset}`;
}
export function chartDateTime(timestamp,timeZone){
  let formatter=calendarFormatters.get(timeZone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});calendarFormatters.set(timeZone,formatter);}
  const parts=Object.fromEntries(formatter.formatToParts(timestamp).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const calendarFormatters=new Map();
export function chartDateTimeInput(timestamp,timeZone){
  const date=new Date(timestamp),seconds=String(date.getUTCSeconds()).padStart(2,'0'),milliseconds=date.getUTCMilliseconds();
  return `${chartDateTime(timestamp,timeZone)}:${seconds}${milliseconds?'.'+String(milliseconds).padStart(3,'0'):''}`;
}
export function parseChartDateTime(value,timeZone,preferTimestamp){
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value||'');
  if(!match||!validTimezone(timeZone))return null;
  const [,year,month,day,hour,minute,second='0',fraction='0']=match;
  const wall=Date.UTC(+year,+month-1,+day,+hour,+minute,+second,+fraction.padEnd(3,'0'));
  const canonical=`${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2,'0')}`;
  if(new Date(wall).toISOString().slice(0,19)!==canonical)return null;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const localWall=timestamp=>{const p=Object.fromEntries(formatter.formatToParts(timestamp).map(p=>[p.type,p.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second,new Date(timestamp).getUTCMilliseconds());};
  const offsets=new Set([-172800000,0,172800000].map(delta=>localWall(wall+delta)-(wall+delta)));
  const matches=[...offsets].map(offset=>wall-offset).filter(timestamp=>localWall(timestamp)===wall).sort((a,b)=>Number.isFinite(preferTimestamp)?Math.abs(a-preferTimestamp)-Math.abs(b-preferTimestamp):a-b);
  return matches[0]??null;
}
// Search local calendar keys: DST gaps choose the next available bar;
// repeated local hours choose the first occurrence in chronological order.
export function findChartBar(candles,value,timeZone){
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)||!candles?.length)return null;
  const key=bar=>chartDateTime(bar.timestamp,timeZone).slice(0,value.length);
  const keys=candles.map(key);
  let first=keys[0],last=keys[0];for(const entry of keys){if(entry<first)first=entry;if(entry>last)last=entry;}
  if(value<first||value>last)return null;
  // Local clock keys can run backwards during a DST fold. Searching timestamps
  // via a fabricated UTC offset would select the wrong hour, so scan actual bars.
  return keys.findIndex(entry=>entry>=value);
}
