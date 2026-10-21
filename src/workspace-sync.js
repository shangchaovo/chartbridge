import {WORKSPACE_SETTING_FIELDS,settingsOperations,sameSetting} from './workspace-settings.js';
import {newId} from './collaboration.js';

const DRAFT_KEY='shanhai-settings-draft';
const sectionOf=kind=>kind==='field'?'fields':'preferences';
const pathOf=operation=>`${operation.kind}/${operation.key}`;
export class WorkspaceSync {
  constructor({api,capture,apply,changed=()=>{},storage,actor,canEdit=true,eventSource=url=>new EventSource(url)}){
    Object.assign(this,{api,capture,apply,changed,storage,actor,canEdit,eventSource});
    this.status='connecting';this.conflicts=[];this.applying=false;this.closed=false;
    this.pending=new Map();this.editSequence=0;this.retryBatch=null;this.blocked=false;this.retryAt=0;
    // Bounded push latency constants; retryMs keeps failed saves from hammering.
    this.debounceMs=120;this.maxWaitMs=500;this.retryMs=1500;
  }
  start(snapshot){
    this.base=structuredClone(snapshot);this.observed=this.capture();
    this.status=snapshot.initialized?'connected':'awaiting-primary';
    let draft;try{draft=JSON.parse(this.storage?.getItem(DRAFT_KEY)||'null');}catch{}
    if(draft?.base?.initialized&&snapshot.initialized&&this.canEdit){
      const operations=Array.isArray(draft.pending)?draft.pending:settingsOperations(draft.base,draft.local);
      for(const operation of operations){
        const edit=operation.edit??++this.editSequence;this.editSequence=Math.max(this.editSequence,edit);
        this.pending.set(pathOf(operation),{...operation,edit});
      }
      this.retryBatch=draft.retryBatch||null;this.applyLocal();
    }
    this.events=this.eventSource('/api/workspace-sync/events');
    this.events.addEventListener('settings',event=>{
      try{this.receive(JSON.parse(event.data));}catch(error){this.status=`同步失败：${error.message}`;this.changed(this);}
    });
    this.events.onopen=()=>{this.status=this.base.initialized?'connected':'awaiting-primary';this.changed(this);this.schedule();};
    this.events.onerror=()=>{this.status='reconnecting';this.changed(this);};
    this.changed(this);this.schedule();
  }
  localState(){
    const local=structuredClone(this.base);
    for(const operation of this.pending.values())local[sectionOf(operation.kind)][operation.key]=structuredClone(operation.value);
    return local;
  }
  applyLocal(){
    this.applying=true;
    try{this.apply(this.localState());this.observed=this.capture();}finally{this.applying=false;}
  }
  record(kind,key,value){
    const path=pathOf({kind,key}),section=sectionOf(kind);
    const inFlight=this.retryBatch?.sent.some(operation=>pathOf(operation)===path);
    if(sameSetting(value,this.base[section]?.[key])&&!inFlight)this.pending.delete(path);
    else this.pending.set(path,{kind,key,value:structuredClone(value??null),edit:++this.editSequence});
  }
  observeFields(){
    const current=this.capture(),previous=this.observed||this.base;
    for(const key of WORKSPACE_SETTING_FIELDS)if(!sameSetting(current.fields[key],previous.fields[key]))this.record('field',key,current.fields[key]);
    this.observed=current;
  }
  receive(snapshot){
    if(this.closed||!this.base||snapshot.revision<=this.base.revision)return;
    if(this.canEdit&&this.base.initialized)this.observeFields();
    if(!this.base.initialized&&snapshot.initialized){
      try{this.storage?.setItem('shanhai-pre-sync-backup',JSON.stringify(this.capture()));}catch{}
      this.pending.clear();this.retryBatch=null;
    }
    this.base=structuredClone(snapshot);this.status=snapshot.initialized?'connected':'awaiting-primary';
    this.prune();this.applyLocal();this.backup();this.changed(this);this.schedule();
  }
  prunedClock(){
    if(this.pending.size&&this.pushSince==null)this.pushSince=Date.now();
    else if(!this.pending.size)this.pushSince=null;
  }
  prune(){
    for(const [path,operation] of this.pending){
      const inFlight=this.retryBatch?.sent.some(sent=>pathOf(sent)===path);
      if(!inFlight&&sameSetting(operation.value,this.base[sectionOf(operation.kind)]?.[operation.key]))this.pending.delete(path);
    }
    this.prunedClock();
  }
  backup(){
    if(!this.base?.initialized||!this.canEdit)return;
    try{
      if(this.pending.size||this.retryBatch)this.storage?.setItem(DRAFT_KEY,JSON.stringify({base:this.base,pending:[...this.pending.values()],retryBatch:this.retryBatch}));
      else this.storage?.removeItem(DRAFT_KEY);
    }catch{}
  }
  schedule({preferenceKey}={}){
    if(this.closed||this.applying||!this.canEdit)return;
    if(preferenceKey)this.record('preference',preferenceKey,this.capture().preferences[preferenceKey]);
    this.observeFields();this.backup();clearTimeout(this.timer);
    if(this.saving)return;
    // Bounded push latency: debounce bursts, but never delay a run of
    // continuous edits past maxWaitMs measured from the first pending edit.
    if(this.pending.size&&this.pushSince==null)this.pushSince=Date.now();
    if(!this.pending.size)this.pushSince=null;
    if(this.pending.size){
      const remaining=Math.max(0,(this.pushSince??Date.now())+this.maxWaitMs-Date.now());
      // An edit racing an in-flight save republishes immediately when the save
      // settles; the debounce only spreads bursts of fresh edits.
      if(!this.blocked)this.timer=setTimeout(()=>void this.flush(),this.retryBatch?Math.max(0,this.retryAt-Date.now()):Math.min(this.debounceMs,remaining));
    }else if(!this.blocked){
      this.timer=setTimeout(()=>void this.flush(),this.retryBatch?Math.max(0,this.retryAt-Date.now()):this.debounceMs);
    }
  }
  async flush(){
    if(this.saving)return this.saving;
    if(this.closed||!this.base?.initialized||!this.canEdit||this.blocked)return true;
    this.observeFields();this.prune();
    if(!this.retryBatch){
      const sent=[...this.pending.values()].map(value=>structuredClone(value));
      if(!sent.length){this.backup();return true;}
      const operations=sent.map(({kind,key,value})=>({kind,key,value,before:this.base[sectionOf(kind)]?.[key]??null}));
      this.retryBatch={body:{baseRevision:this.base.revision,batchId:newId(),operations},sent};
    }
    const batch=this.retryBatch;this.backup();this.status='saving';this.changed(this);
    this.saving=(async()=>{
      try{
        const snapshot=await this.api('/api/workspace-sync',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(batch.body)});
        if(this.closed)return false;
        // A response may follow a newer SSE revision. Acknowledge only edits
        // saved by this request, retaining edits made while it was in flight.
        this.observeFields();
        for(const operation of batch.sent){const path=pathOf(operation);if(this.pending.get(path)?.edit===operation.edit)this.pending.delete(path);}
        this.retryBatch=null;this.retryAt=0;
        if(snapshot.revision>this.base.revision)this.base=structuredClone(snapshot);
        this.prune();this.applyLocal();this.status='connected';
        if(!this.pending.size)this.pushSince=null;
        return true;
      }catch(error){
        if(this.closed)return false;
        if(error.status===409&&error.details?.current){this.retryBatch=null;this.retryAt=0;this.receive(error.details.current);return false;}
        this.status=`同步失败：${error.message}`;
        if([400,403,413].includes(error.status)){this.retryBatch=null;this.blocked=true;}
        else this.retryAt=Date.now()+this.retryMs;
        return false;
      }finally{
        this.saving=null;if(!this.closed){this.backup();this.changed(this);}
        if(!this.closed&&!this.blocked&&(this.pending.size||this.retryBatch)){
          clearTimeout(this.timer);
          // pending retains the failed batch's edits too. Only a successful save
          // may immediately publish newer edits; uncertain batches keep backoff.
          const backoff=this.retryBatch?Math.max(0,this.retryAt-Date.now()):0;
          this.timer=setTimeout(()=>void this.flush(),backoff);
        }
      }
    })();
    return this.saving;
  }
  async refresh(){
    try{this.receive(await this.api('/api/workspace-sync'));this.blocked=false;}catch(error){this.status=`同步失败：${error.message}`;this.changed(this);}
    await this.flush();
  }
  async adopt(label='MacBook'){
    if(!this.canEdit)throw new Error('只读终端不能初始化同步。');
    const local=this.capture(),snapshot=await this.api('/api/workspace-sync/adopt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...local,source:{id:this.actor.id,label},baseRevision:this.base.revision})});
    this.receive(snapshot);return snapshot;
  }
  close(){this.closed=true;clearTimeout(this.timer);this.backup();this.events?.close();}
}
