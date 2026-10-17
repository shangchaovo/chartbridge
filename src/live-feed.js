export class LiveFeed {
  constructor({event,status}){this.event=event;this.status=status;}
  connect(symbol,interval,symbols=[],secondaryInterval=null){
    const key=JSON.stringify([symbol,interval,symbols,secondaryInterval]);if(this.key===key&&this.source)return;this.close();this.key=key;this.source=new EventSource(`/api/stream?${new URLSearchParams({symbol,interval,...(secondaryInterval?{secondaryInterval}:{}),symbols:symbols.filter(s=>!s.startsWith('CSV:')).slice(0,47).join(',')})}`);
    for(const type of ['candle','quote','status','alert'])this.source.addEventListener(type,message=>{try{const data=JSON.parse(message.data);if(type==='status')this.status(data);else this.event(data);}catch{/* Invalid stream records are ignored. */}});
    this.source.onopen=()=>this.status({provider:'connection',status:'connected'});
    this.source.onerror=()=>this.status({provider:'connection',status:'reconnecting',message:'连接中断，正在重新连接。'});
  }
  close(){this.source?.close();this.source=null;this.key=null;}
}
