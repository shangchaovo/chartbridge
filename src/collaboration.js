import { chartStateFromWorkspace, chartStateAfterOperations, diffChartStates, mergeChartStates } from './collab-state.js';
export function newId(){return globalThis.crypto?.randomUUID?.()||`c-${[...crypto.getRandomValues(new Uint32Array(4))].map(n=>n.toString(16)).join('-')}`;}

export class ChartCollaboration {
  constructor({api,capture,apply,changed,actor,canEdit=true}){
    Object.assign(this,{api,capture,apply,changed,actor,canEdit});
    this.conflicts=[];this.status='connecting';this.applying=false;this.closed=false;
    // Bounded push latency: short debounce for burst edits, plus a hard cap so a
    // continuous stream of edits (dragging, typing) still publishes promptly.
    this.debounceMs=200;this.maxWaitMs=800;this.retryMs=3000;this.retryAt=0;
  }
  start(snapshot){
    this.base=structuredClone(snapshot);this.status='connected';this.events=new EventSource('/api/chart/events?room=main');
    this.events.addEventListener('chart',event=>{try{this.receive(JSON.parse(event.data));}catch(error){this.status=error.message;this.changed(this);}});
    this.events.onopen=()=>{this.status='connected';this.changed(this);void this.refresh();};
    this.events.onerror=()=>{this.status='reconnecting';this.changed(this);};this.changed(this);
  }
  localState(){return chartStateFromWorkspace(this.capture());}
  receive(snapshot,acknowledgedBatch=null){
    if(this.closed||!this.base||snapshot.revision<=this.base.revision)return;
    const ownBatch=acknowledgedBatch||(snapshot.batchId===this.retryBatch?.batchId?this.retryBatch:null);
    const baseline=ownBatch?chartStateAfterOperations(this.base.state,ownBatch.operations):this.base.state;
    const {state,conflicts}=this.canEdit?mergeChartStates(baseline,this.localState(),snapshot.state):{state:snapshot.state,conflicts:[]};
    this.base=structuredClone(snapshot);this.conflicts=[...new Set([...this.conflicts,...conflicts])];
    this.applying=true;try{this.apply(state);}finally{this.applying=false;}
    this.changed(this);if(!this.conflicts.length)this.schedule();
  }
  schedule(){
    if(this.closed||this.blocked||!this.canEdit||this.applying)return;
    clearTimeout(this.timer);
    // Push the first edit quickly; continuous edits flush at maxWaitMs instead
    // of being postponed indefinitely by the debounce. An edit racing an
    // in-flight save republishes as soon as that save settles.
    if(this.saving){this.racing=true;return;}
    if(this.timerSince==null)this.timerSince=Date.now();
    const remaining=Math.max(0,this.timerSince+this.maxWaitMs-Date.now());
    this.timer=setTimeout(()=>this.flush(),this.retryBatch?Math.max(0,this.retryAt-Date.now()):Math.min(this.debounceMs,remaining));
  }
  async refresh(){
    if(this.closed)return;
    try{const snapshot=await this.api('/api/chart?room=main');if(this.closed)return;this.blocked=false;this.receive(snapshot);this.schedule();}catch(error){if(!this.closed){this.status=`同步失败：${error.message}`;this.changed(this);}}
  }
  async flush(){
    if(this.saving){
      this.racing=true;return this.inFlight;
    }
    if(this.closed||this.blocked||!this.base||this.conflicts.length||!this.canEdit)return;
    const operations=diffChartStates(this.base.state,this.localState()).slice(0,100);if(!operations.length&&!this.retryBatch){this.changed(this);this.timerSince=null;return;}
    this.saving=true;this.changed(this);
    // Preserve the exact batch on an uncertain network result, so retries are idempotent.
    const batch=this.retryBatch||{baseRevision:this.base.revision,batchId:newId(),actor:this.actor,operations};this.retryBatch=batch;
    this.inFlight=(async()=>{try{
      const next=await this.api('/api/chart/operations?room=main',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch)});
      if(this.closed)return;
      this.receive(next,batch);this.retryBatch=null;this.retryAt=0;this.blocked=false;this.status='connected';
      if(!diffChartStates(this.base.state,this.localState()).length)this.timerSince=null;
    }catch(error){
      if(this.closed)return;
      if(error.status===409&&error.details?.current){this.retryBatch=null;this.retryAt=0;this.receive(error.details.current);}
      else{this.status=`保存失败：${error.message}`;if([400,403,413].includes(error.status)){this.retryBatch=null;this.blocked=true;}else this.retryAt=Date.now()+this.retryMs;}
    }finally{
      this.saving=false;if(!this.closed)this.changed(this);
      const raced=this.racing;this.racing=false;
      if(!this.closed&&this.retryBatch){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),Math.max(0,this.retryAt-Date.now()));}
      else if(!this.closed&&!this.blocked&&!this.conflicts.length&&diffChartStates(this.base.state,this.localState()).length){
        // An edit that raced the in-flight save republishes immediately;
        // fresh edits keep their debounce.
        clearTimeout(this.timer);
        this.timer=setTimeout(()=>this.flush(),raced?0:this.debounceMs);
      }
    }})();return this.inFlight;
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
  close(){this.closed=true;clearTimeout(this.timer);this.events?.close();}
}
