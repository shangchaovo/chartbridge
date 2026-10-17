import { chartStateFromWorkspace, diffChartStates, mergeChartStates } from './collab-state.js';
export function newId(){return globalThis.crypto?.randomUUID?.()||`c-${[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16)).join('-')}`;}

export class ChartCollaboration {
  constructor({api,capture,apply,changed,actor,canEdit=true}){Object.assign(this,{api,capture,apply,changed,actor,canEdit});this.conflicts=[];this.status='connecting';this.applying=false;}
  start(snapshot){
    this.base=structuredClone(snapshot);this.status='connected';this.events=new EventSource('/api/chart/events?room=main');
    this.events.addEventListener('chart',event=>{try{this.receive(JSON.parse(event.data));}catch(error){this.status=error.message;this.changed(this);}});
    this.events.onopen=()=>{this.status='connected';this.changed(this);};
    this.events.onerror=()=>{this.status='reconnecting';this.changed(this);};this.changed(this);
  }
  localState(){return chartStateFromWorkspace(this.capture());}
  receive(snapshot){
    if(!this.base||snapshot.revision<=this.base.revision)return;
    const {state,conflicts}=this.canEdit?mergeChartStates(this.base.state,this.localState(),snapshot.state):{state:snapshot.state,conflicts:[]};
    this.base=structuredClone(snapshot);this.conflicts=[...new Set([...this.conflicts,...conflicts])];
    this.applying=true;try{this.apply(state);}finally{this.applying=false;}
    this.changed(this);if(!this.conflicts.length)this.schedule();
  }
  schedule(){if(!this.canEdit||this.applying)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),650);}
  async flush(){
    if(this.saving||!this.base||this.conflicts.length||!this.canEdit)return;
    const operations=diffChartStates(this.base.state,this.localState()).slice(0,100);if(!operations.length&&!this.retryBatch){this.changed(this);return;}
    this.saving=true;this.changed(this);
    // Preserve the exact batch on an uncertain network result, so retries are idempotent.
    const batch=this.retryBatch||{baseRevision:this.base.revision,batchId:newId(),actor:this.actor,operations};this.retryBatch=batch;
    try{
      const next=await this.api('/api/chart/operations?room=main',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});
      this.retryBatch=null;this.blocked=false;this.receive(next);this.status='connected';
    }catch(error){
      if(error.status===409&&error.details?.current){this.retryBatch=null;this.receive(error.details.current);}
      else{this.status=`保存失败：${error.message}`;if([400,403,413].includes(error.status)){this.retryBatch=null;this.blocked=true;}}
    }finally{this.saving=false;this.changed(this);if(this.retryBatch){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),3000);}else if(!this.blocked&&!this.conflicts.length&&diffChartStates(this.base.state,this.localState()).length)this.schedule();}
  }
  resolve(choice){
    if(choice==='remote'){
      const next=this.localState(),remote=this.base.state;
      for(const path of this.conflicts){
        if(path.startsWith('drawings/')){const end=path.lastIndexOf('/'),key=path.slice(9,end),id=path.slice(end+1),value=remote.drawings[key]?.find(d=>d.id===id);next.drawings[key]=(next.drawings[key]||[]).filter(d=>d.id!==id);if(value)next.drawings[key].push(structuredClone(value));}
        else if(path.startsWith('notes/')){const id=path.slice(6);if(remote.notes[id])next.notes[id]=structuredClone(remote.notes[id]);else delete next.notes[id];}
        else next[path]=structuredClone(remote[path]);
      }
      this.applying=true;try{this.apply(next);}finally{this.applying=false;}
    }
    this.conflicts=[];this.retryBatch=null;this.changed(this);this.schedule();
  }
  close(){clearTimeout(this.timer);this.events?.close();}
}
