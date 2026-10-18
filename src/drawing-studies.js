export function anchoredVwap(candles,start=0,end=candles.length-1) {
  let volume=0,weighted=0;const values=[];
  for(let i=Math.max(0,start);i<=Math.min(end,candles.length-1);i++){
    const b=candles[i];if(![b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.volume<0)continue;
    volume+=b.volume;weighted+=(b.high+b.low+b.close)/3*b.volume;
    if(volume>0)values.push({index:i,timestamp:b.timestamp,value:weighted/volume});
  }
  return values;
}
export function regressionChannel(candles,start=0,end=candles.length-1) {
  const rows=candles.slice(start,end+1);if(rows.length<2||rows.some(bar=>!Number.isFinite(bar.close)))return null;
  const n=rows.length,xMean=(n-1)/2,yMean=rows.reduce((sum,bar)=>sum+bar.close,0)/n;
  let xy=0,xx=0,total=0,residual=0;
  rows.forEach((bar,i)=>{xy+=(i-xMean)*(bar.close-yMean);xx+=(i-xMean)**2;total+=(bar.close-yMean)**2;});
  const slope=xy/xx,intercept=yMean-slope*xMean;
  rows.forEach((bar,i)=>{residual+=(bar.close-intercept-slope*i)**2;});
  return {start:intercept,end:intercept+slope*(n-1),slope,deviation:Math.sqrt(residual/n),rSquared:total===0?1:Math.max(0,1-residual/total),count:n};
}
export function candleVolumeProfile(candles,count=24) {
  if(!Number.isInteger(count)||count<2||count>100)throw new Error('量能分布分箱数量无效。');
  const rows=candles.filter(b=>[b.low,b.high,b.close,b.volume].every(Number.isFinite)&&b.low<=b.high&&b.volume>=0);
  const total=rows.reduce((sum,b)=>sum+b.volume,0);if(!rows.length||total<=0)return null;
  const low=Math.min(...rows.map(b=>b.low)),rawHigh=Math.max(...rows.map(b=>b.high)),high=rawHigh===low?low+Math.max(Math.abs(low)*1e-6,1e-8):rawHigh,width=(high-low)/count;
  const bins=Array.from({length:count},(_,index)=>({low:low+index*width,high:low+(index+1)*width,volume:0}));
  for(const b of rows){
    if(b.high===b.low){bins[Math.max(0,Math.min(count-1,Math.floor((b.close-low)/width)))].volume+=b.volume;continue;}
    for(const bin of bins){const overlap=Math.max(0,Math.min(bin.high,b.high)-Math.max(bin.low,b.low));bin.volume+=b.volume*overlap/(b.high-b.low);}
  }
  const max=Math.max(...bins.map(b=>b.volume)),poc=bins.findIndex(b=>b.volume===max);let left=poc,right=poc,area=bins[poc].volume;
  while(area<total*.7&&(left>0||right<count-1)){
    if(right===count-1||(left>0&&bins[left-1].volume>=bins[right+1].volume))area+=bins[--left].volume;
    else area+=bins[++right].volume;
  }
  return {bins,total,poc,max,pocPrice:(bins[poc].low+bins[poc].high)/2,val:bins[left].low,vah:bins[right].high,valueAreaVolume:area};
}
export function studyIndexRange(candles,points) {
  if(!candles.length||!points.length)return null;
  const index=p=>{
    if(Number.isFinite(p.timestamp)){
      let lo=0,hi=candles.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(candles[mid].timestamp<p.timestamp)lo=mid+1;else hi=mid;}
      return lo>0&&Math.abs(candles[lo-1].timestamp-p.timestamp)<Math.abs(candles[lo].timestamp-p.timestamp)?lo-1:lo;
    }
    return Math.max(0,Math.min(candles.length-1,Number.isInteger(p.dataIndex)?p.dataIndex:0));
  };
  const first=index(points[0]),last=points[1]?index(points[1]):candles.length-1;
  return [Math.min(first,last),Math.max(first,last)];
}
