const MINUTE=60_000,DAY=86_400_000;
export const INTERVAL_MS=Object.freeze({'1m':MINUTE,'5m':5*MINUTE,'15m':15*MINUTE,'30m':30*MINUTE,'1h':60*MINUTE,'4h':240*MINUTE,'1d':DAY,'1w':7*DAY});
export function formatCountdown(milliseconds){
  if(!Number.isFinite(milliseconds)||milliseconds<0)return '';
  const seconds=Math.ceil(milliseconds/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds/3600)%24,minutes=Math.floor(seconds/60)%60;
  const pad=n=>String(n).padStart(2,'0');
  return `${days?`${days}d `:''}${days||hours?`${pad(hours)}:`:''}${pad(minutes)}:${pad(seconds%60)}`;
}
// Use the actual bar deadline. Never wrap an expired bar into a fictitious one.
export function barCountdown({bar,interval,meta={},now=Date.now(),enabled=true,replay=false,imported=false,paused=false,continuous=false}={}){
  const hidden=reason=>({visible:false,reason});
  if(!enabled)return hidden('disabled');
  if(replay)return hidden('replay');
  if(imported||meta.provider==='csv')return hidden('imported');
  if(paused)return hidden('paused');
  if(meta.cache==='stale')return hidden('stale');
  const duration=INTERVAL_MS[interval];
  if(!duration||!Number.isFinite(bar?.timestamp)||!Number.isFinite(now))return hidden('unavailable');
  if(Number.isFinite(meta.delayMinutes)&&meta.delayMinutes*MINUTE>=duration)return hidden('delayed');
  if(bar.closed===true)return hidden('closed');
  if(now<bar.timestamp)return hidden('future');
  const session=meta.currentSession;
  const validSession=Number.isFinite(session?.start)&&Number.isFinite(session?.end)&&session.end>session.start;
  let deadline;
  if(Number.isFinite(bar.closeTime)&&bar.closeTime>=bar.timestamp){deadline=bar.closeTime+1;}
  else if(duration<DAY){deadline=bar.timestamp+duration;}
  else if(continuous){deadline=bar.timestamp+duration;}
  else if(interval==='1d'&&validSession&&bar.timestamp>=session.start&&bar.timestamp<session.end){deadline=session.end;}
  else return hidden('unknown-session');
  if(!continuous&&validSession&&duration<DAY){
    if(now<session.start||now>=session.end||bar.timestamp<session.start)return hidden('market-closed');
    deadline=Math.min(deadline,session.end);
  }
  if(now>=deadline)return hidden('closed');
  const remainingMs=deadline-now;
  return {visible:true,deadline,remainingMs,text:formatCountdown(remainingMs)};
}
// Axis overlay is part of the canvas, so PNG exports include the countdown.
export function registerCountdownOverlay(register){
  register({name:'localBarCountdown',totalStep:1,needDefaultPointFigure:false,needDefaultXAxisFigure:false,needDefaultYAxisFigure:false,
    createPointFigures:()=>[],createYAxisFigures:({overlay,bounding,yAxis})=>{
      const data=overlay.extendData;if(!data?.text)return [];
      const priceY=yAxis.convertToNicePixel(overlay.points[0].value);
      // Match the native latest-price label and keep both rows in the pane.
      const y=priceY+29>bounding.height?Math.max(0,priceY-29):priceY+11;
      const size=Math.min(11,Math.max(8,(bounding.width-8)/(data.text.length*.65)));
      return [{type:'text',attrs:{x:yAxis.isFromZero()?0:bounding.width,y,text:data.text,align:yAxis.isFromZero()?'left':'right',baseline:'top'},styles:{color:'#ffffff',backgroundColor:data.color,size,paddingLeft:4,paddingRight:4,paddingTop:2,paddingBottom:2,borderRadius:2},ignoreEvent:true}];
    }});
}
