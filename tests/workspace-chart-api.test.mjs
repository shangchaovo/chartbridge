import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('HTTP workspace reads, old PUTs, SSE updates and restart all retain versioned chart state',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'chartbridge-chart-api-'));
 const seed={id:'plan',name:'rect',lock:true,points:[{dataIndex:10,value:100},{dataIndex:20,value:90}]};
 await writeFile(join(dir,'workspace.json'),JSON.stringify({watchlist:['AAPL'],drawings:{'BTCUSDT|1d':[seed]},notes:{}}));
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const url='http://127.0.0.1:'+port;
 let child,logs='';const stop=async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 async function start(){
  child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,TERMINAL_PORT:String(port),TERMINAL_HOST:'127.0.0.1',TERMINAL_DATA_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
  for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(logs);try{const r=await fetch(url+'/api/chart');if(r.ok)return;}catch{}await pause(50);}throw Error('Server did not start: '+logs);
 }
 const get=async path=>{const r=await fetch(url+path);assert.equal(r.status,200);return r.json();};
 const send=async(path,method,body)=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 await start();const initial=await get('/api/chart');const eventsAbort=new AbortController();const events=await fetch(url+'/api/chart/events',{signal:eventsAbort.signal});const reader=events.body.getReader();let text='';
 const received=(async()=>{try{while(true){const {done,value}=await reader.read();if(done)return;text+=new TextDecoder().decode(value);}}catch(error){if(error.name!=='AbortError')throw error;}})();
 const updated={...seed,lock:false,points:[{dataIndex:10,value:120},{dataIndex:20,value:110}]};
 const committed=await send('/api/chart/operations','POST',{baseRevision:initial.revision,batchId:'api-review',actor:{id:'review',name:'Review'},operations:[{type:'upsert_drawing',key:'BTCUSDT|1d',drawing:updated}]});
 for(let i=0;i<80&&!text.includes('"batchId":"api-review"');i++)await pause(10);
 assert.ok(text.includes('"batchId":"api-review"'),'real SSE publishes the saved batch');
 await send('/api/state','PUT',{watchlist:['AAPL','MSFT'],drawings:{'BTCUSDT|1d':[seed]},notes:{}});
 assert.deepEqual((await get('/api/state')).drawings['BTCUSDT|1d'],[updated]);assert.equal((await get('/api/chart')).revision,committed.revision);
 assert.deepEqual((await get('/api/state')).watchlist,['AAPL','MSFT']);
 eventsAbort.abort();await received;await stop();await start();
 assert.deepEqual((await get('/api/chart')).state.drawings['BTCUSDT|1d'],[updated]);assert.deepEqual((await get('/api/state')).drawings['BTCUSDT|1d'],[updated]);
});
