import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { chartStateFromWorkspace, CHART_FIELDS } from '../src/collab-state.js';
import { SAVED_DRAWING_TYPES } from '../src/drawing-catalog.js';

const intervals=new Set(['1m','5m','15m','30m','1h','4h','1d','1w']);
const overlays=new Set(SAVED_DRAWING_TYPES);
const forbidden=new Set(['__proto__','prototype','constructor']);
function fail(message,status=400,details={}){throw Object.assign(new Error(message),{status,code:status===409?'REVISION_CONFLICT':'INVALID_CHART_OPERATION',details});}
function id(value,label='ID'){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(value)||forbidden.has(value))fail(`${label} 无效。`);return value;}
function symbol(value){if(typeof value!=='string'||value.length>80||!value.length||/[\x00-\x1f|]/.test(value))fail('行情代码无效。');return value;}
function finite(value){return typeof value==='number'&&Number.isFinite(value);}
function safeJson(value,depth=0){
  if(depth>12)fail('图表参数嵌套过深。');
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(forbidden.has(key))fail('图表参数包含无效属性。');safeJson(child,depth+1);}
}
function checkField(field,value){
  if(!CHART_FIELDS.includes(field))fail('不能修改该工作区字段。');
  if(field==='symbol')symbol(value);
  if(field==='interval'&&!intervals.has(value))fail('K线周期无效。');
  if(field==='chartType'&&!['candle_solid','area','ohlc','candle_hollow'].includes(value))fail('图表类型无效。');
  if(field==='indicators'&&(!Array.isArray(value)||value.length>12||value.some(v=>typeof v!=='string'||!/^[A-Z0-9_]{1,20}$/.test(v))))fail('技术指标列表无效，最多 12 项。');
  if(field==='indicatorParams'){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>50)fail('指标参数无效。');
    for(const [name,params] of Object.entries(value))if(!/^[A-Z0-9_]{1,20}$/.test(name)||!Array.isArray(params)||params.length>12||params.some(v=>!finite(v)||v<=0||v>10000))fail('指标参数必须是有效正数。');
  }
  if(field==='pineCode'&&(typeof value!=='string'||value.length>100000))fail('Pine 源码过长或格式错误。');
}
function drawingKey(value){if(typeof value!=='string'||value.length>100)fail('画线的行情与周期无效。');const split=value.lastIndexOf('|');symbol(value.slice(0,split));if(split<1||!intervals.has(value.slice(split+1)))fail('画线的行情与周期无效。');return value;}
function validateDrawing(value){
  if(!value||typeof value!=='object'||!overlays.has(value.name))fail('不支持该画线类型。');id(value.id,'画线 ID');
  if(!Array.isArray(value.points)||!value.points.length||value.points.length>12)fail('画线锚点无效。');
  for(const p of value.points)if(!p||!finite(p.value)||(!finite(p.timestamp)&&!Number.isInteger(p.dataIndex)))fail('画线需要价格和时间或数据索引锚点。');
  if(value.extendData!==undefined&&(typeof value.extendData!=='string'||value.extendData.length>1000))fail('画线标注文字无效。');
  if(value.visible!==undefined&&typeof value.visible!=='boolean')fail('画线显示状态无效。');
  if(value.styles!==undefined&&value.styles!==null&&(typeof value.styles!=='object'||JSON.stringify(value.styles).length>8000))fail('画线样式无效。');
  safeJson(value);return {id:value.id,name:value.name,points:value.points.map(p=>({...p})),...(value.styles!==undefined?{styles:value.styles}:{}),...(value.extendData!==undefined?{extendData:value.extendData}:{}),...(value.visible!==undefined?{visible:value.visible}:{}),lock:Boolean(value.lock)};
}

export class SharedCharts extends EventEmitter {
  constructor(path,initial={}){
    super();this.initial=chartStateFromWorkspace(initial);this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS charts(room TEXT PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS changes(room TEXT NOT NULL,revision INTEGER NOT NULL,batch TEXT NOT NULL,hash TEXT NOT NULL,actor TEXT NOT NULL,operations TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(room,revision),UNIQUE(room,batch));');
  }
  get(room='main'){
    id(room,'协作房间');let row=this.db.prepare('SELECT * FROM charts WHERE room=?').get(room);
    if(!row){this.db.prepare('INSERT INTO charts VALUES(?,0,?,?)').run(room,JSON.stringify(this.initial),Date.now());row=this.db.prepare('SELECT * FROM charts WHERE room=?').get(room);}
    return {roomId:room,revision:row.revision,state:JSON.parse(row.state),updatedAt:row.updated};
  }
  apply(room,{baseRevision,batchId,operations,actor},principal){
    id(room,'协作房间');id(batchId,'操作批次');
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0)fail('baseRevision 必须是读取图表时的版本号。');
    if(!Array.isArray(operations)||!operations.length||operations.length>100)fail('每批需要 1 至 100 项修改。');
    safeJson(operations);const hash=createHash('sha256').update(JSON.stringify({baseRevision,operations})).digest('hex');
    const identity={id:id(actor?.id||'anonymous','编辑者 ID'),name:String(actor?.name||'未命名').slice(0,80),kind:principal.kind||'human',role:principal.role};
    if(!['editor','owner'].includes(principal.role))fail('只读凭据不能修改图表。',403);
    this.get(room);this.db.exec('BEGIN IMMEDIATE');let result;
    try{
      const receipt=this.db.prepare('SELECT * FROM changes WHERE room=? AND batch=?').get(room,batchId);
      if(receipt){if(receipt.hash!==hash)fail('同一批次 ID 不能提交不同内容。',409);const current=this.get(room);this.db.exec('COMMIT');return {...current,replayed:true,committedRevision:receipt.revision};}
      const current=this.get(room);if(current.revision!==baseRevision)fail('图表已有新版本。请重新读取并合并，不要覆盖其他人的编辑。',409,{current});
      const next=structuredClone(current.state);
      for(const operation of operations){
        if(!operation||typeof operation!=='object')fail('修改格式无效。');
        if(operation.type==='set_field'){checkField(operation.field,operation.value);next[operation.field]=structuredClone(operation.value);}
        else if(operation.type==='upsert_drawing'){
          const key=drawingKey(operation.key),drawing=validateDrawing(operation.drawing);const values=next.drawings[key]||[];next.drawings[key]=[...values.filter(v=>v.id!==drawing.id),drawing];
        }else if(operation.type==='remove_drawing'){const key=drawingKey(operation.key);id(operation.id);next.drawings[key]=(next.drawings[key]||[]).filter(v=>v.id!==operation.id);}
        else if(operation.type==='upsert_note'){
          const note=operation.note;id(note?.id,'批注 ID');symbol(note.symbol);if(!intervals.has(note.interval)||typeof note.text!=='string'||!note.text.trim()||note.text.length>2000)fail('批注需要标的、周期与最多 2000 字文字。');
          if(note.timestamp!==undefined&&!finite(note.timestamp))fail('批注时间无效。');if(note.price!==undefined&&!finite(note.price))fail('批注价格无效。');
          next.notes[note.id]={id:note.id,symbol:note.symbol,interval:note.interval,text:note.text,...(finite(note.timestamp)?{timestamp:note.timestamp}:{}),...(finite(note.price)?{price:note.price}:{}),author:identity,updatedAt:Date.now()};
        }else if(operation.type==='remove_note'){id(operation.id);delete next.notes[operation.id];}
        else fail('未知图表操作。');
      }
      if(Object.values(next.drawings).reduce((sum,items)=>sum+items.length,0)>2000||Object.keys(next.notes).length>500)fail('协作图表达到保存上限，请清理不再需要的画线或批注。');
      const at=Date.now(),revision=current.revision+1;
      this.db.prepare('UPDATE charts SET revision=?,state=?,updated=? WHERE room=?').run(revision,JSON.stringify(next),at,room);
      this.db.prepare('INSERT INTO changes VALUES(?,?,?,?,?,?,?)').run(room,revision,batchId,hash,JSON.stringify(identity),JSON.stringify(operations),at);
      this.db.exec('COMMIT');result={roomId:room,revision,state:next,updatedAt:at,actor:identity,batchId};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.emit('change',result);return result;
  }
  history(room='main',after=0,limit=25){id(room);return this.db.prepare('SELECT revision,batch,actor,operations,created FROM changes WHERE room=? AND revision>? ORDER BY revision LIMIT ?').all(room,after,Math.min(100,limit)).map(row=>({revision:row.revision,batchId:row.batch,actor:JSON.parse(row.actor),operations:JSON.parse(row.operations),at:row.created}));}
  close(){this.db.close();}
}
