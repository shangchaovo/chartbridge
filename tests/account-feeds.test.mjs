import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { AccountFeeds,DEFAULT_ACCOUNT_CONFIG,validateAccountConfig } from '../server/account-feeds.mjs';
import { MarketHub } from '../server/market-hub.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
async function fixture(options={}){
  await mkdir(join(root,'work'),{recursive:true});
  const dir=await mkdtemp(join(root,'work','account-test-'));const children=[];
  const spawnChild=(command,args,opts)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{child.signal=signal;child.stdout.end();child.stderr.end();child.emit('close',0);};children.push({child,command,args,opts});return child;};
  // The child is injected; use an existing cross-platform file for preflight.
  const feeds=await new AccountFeeds({root,dataDir:dir,env:{},pythonPath:process.execPath,spawnChild,...options}).init();
  return {dir,feeds,children,close:async()=>{await feeds.disconnect();await rm(dir,{recursive:true,force:true});}};
}
const config=()=>({...structuredClone(DEFAULT_ACCOUNT_CONFIG),enabled:true,intervals:['1m']});
const credentialEnv={SHANHAI_TQ_USER:'synthetic-test-user',SHANHAI_TQ_PASSWORD:'synthetic-test-password'};
const quote=(timestamp=Date.now())=>({type:'quote',sourceSymbol:'KQ.m@SHFE.rb',quote:{price:101,timestamp,previousClose:100,change:1,changePercent:1,volume:5}});
const candle=(timestamp,close=101,closed=false)=>({timestamp,open:100,high:105,low:99,close,volume:5,closed});
test('account configuration starts disabled and never starts a connection on load',async()=>{
  const f=await fixture();try{assert.equal(f.children.length,0);const s=await f.feeds.status();assert.equal(s.credentialsReady,false);assert.equal(s.connected,false);assert.equal(f.feeds.catalog().length,0);}finally{await f.close();}
});
test('configuration saves without credentials and does not accept secret values',async()=>{
  const f=await fixture();try{
    await f.feeds.save(config());const saved=JSON.parse(await readFile(join(f.dir,'market-accounts.json'),'utf8'));assert.equal(saved.enabled,true);assert.equal(saved.passwordEnv,'SHANHAI_TQ_PASSWORD');assert.equal(f.children.length,0);
    assert.throws(()=>validateAccountConfig({...config(),password:'do-not-save'}),e=>e.code==='ACCOUNT_CONFIG_INVALID');
    assert.throws(()=>validateAccountConfig({...config(),symbols:['../../bad']}));assert.throws(()=>validateAccountConfig({...config(),userEnv:'HOME'}));
    assert.equal(f.feeds.catalog()[0].symbol,'TQ:KQ.m@SHFE.rb');
  }finally{await f.close();}
});
test('disabled, absent credentials and absent runtime are distinct preflight failures',async()=>{
  const f=await fixture();try{
    await assert.rejects(f.feeds.connect(),e=>e.code==='ACCOUNT_DISABLED');await f.feeds.save(config());await assert.rejects(f.feeds.connect(),e=>e.code==='CREDENTIALS_MISSING');
    f.feeds.env=credentialEnv;f.feeds.python=join(f.dir,'missing-python');await assert.rejects(f.feeds.connect(),e=>e.code==='SDK_NOT_INSTALLED');assert.equal(f.children.length,0);
  }finally{await f.close();}
});
test('bridge becomes connected only after valid source data and forwards it to the market hub',async()=>{
  const f=await fixture({env:credentialEnv}),hub=new MarketHub({publicQuotes:async()=>[],history:async()=>{throw new Error('not an account source');},accounts:f.feeds});f.feeds.on('data',e=>hub.publish(e));
  try{
    await f.feeds.save(config());await f.feeds.connect();assert.equal(f.feeds.state,'connecting');assert.ok(f.children[0].args.every(a=>!a.includes(credentialEnv.SHANHAI_TQ_PASSWORD)));
    const pending=hub.quote('TQ:KQ.m@SHFE.rb',200);f.children[0].child.stdout.write(JSON.stringify(quote())+'\n');const result=await pending;
    assert.equal(result.quote.price,101);assert.equal(result.meta.provider,'tqsdk');assert.equal(f.feeds.state,'connected');assert.equal(result.fresh,true);
    await f.feeds.disconnect();const offline=await hub.quote('TQ:KQ.m@SHFE.rb',100);assert.equal(offline.fresh,false);assert.equal(offline.connectionState,'disconnected');
    f.feeds.receive({type:'quote',sourceSymbol:'SHFE.other2701',quote:quote().quote});assert.equal(f.feeds.quotes.size,1);
    f.feeds.receive(quote(1));assert.notEqual(f.feeds.quotes.get('TQ:KQ.m@SHFE.rb').quote.timestamp,1);
  }finally{hub.close();await f.close();}
});
test('account history merges incremental bars and is explicitly stale after disconnect',async()=>{
  const f=await fixture({env:credentialEnv}),events=[];f.feeds.on('data',e=>{if(e.type==='candle')events.push(e);});try{
    await f.feeds.save(config());await f.feeds.connect();f.feeds.receive(quote());
    f.feeds.receive({type:'candles',sourceSymbol:'KQ.m@SHFE.rb',interval:'1m',candles:[candle(1000,101,true),candle(61000)]});
    f.feeds.receive({type:'candles',sourceSymbol:'KQ.m@SHFE.rb',interval:'1m',candles:[candle(61000,103,true),candle(121000,102),{...candle(181000),close:1000}]});
    let value=await f.feeds.candles({symbol:'TQ:KQ.m@SHFE.rb',interval:'1m',limit:10});assert.equal(value.candles.length,3);assert.equal(value.candles[1].close,103);assert.equal(value.candles[1].closed,true);
    assert.deepEqual(events.slice(-2).map(e=>[e.candle.timestamp,e.candle.closed]),[[61000,true],[121000,false]]);
    await f.feeds.disconnect();value=await f.feeds.candles({symbol:'TQ:KQ.m@SHFE.rb',interval:'1m',limit:10});assert.equal(value.meta.cache,'stale');assert.equal(value.meta.feedType,'snapshot');assert.equal(f.children[0].child.signal,'SIGTERM');
  }finally{await f.close();}
});
test('raw SDK errors and environment secrets never appear in returned status',async()=>{
  const f=await fixture({env:credentialEnv});try{await f.feeds.save(config());await f.feeds.connect();f.children[0].child.stderr.write(credentialEnv.SHANHAI_TQ_PASSWORD);f.feeds.receive({type:'error',code:'CONNECTION_FAILED',message:credentialEnv.SHANHAI_TQ_PASSWORD});const status=JSON.stringify(await f.feeds.status());assert.ok(!status.includes(credentialEnv.SHANHAI_TQ_PASSWORD));assert.ok(!status.includes(credentialEnv.SHANHAI_TQ_USER));assert.equal(f.feeds.state,'error');}finally{await f.close();}
});
test('account symbols never fall through to Yahoo while disconnected',async()=>{
  let requests=0;const hub=new MarketHub({history:async()=>{requests++;throw new Error('unexpected');}});const release=hub.subscribe([{symbol:'TQ:KQ.m@SHFE.rb',interval:'1m'}],()=>{});
  try{await hub.tick();assert.equal(requests,0);}finally{release();hub.close();}
});
test('queued saves and connect use the final committed account configuration',async()=>{
  const f=await fixture({env:credentialEnv});try{
    const one=f.feeds.save(config()),two=f.feeds.save({...config(),symbols:['SHFE.rb2701']}),connect=f.feeds.connect();await Promise.all([one,two,connect]);
    assert.deepEqual(f.feeds.config.symbols,['SHFE.rb2701']);assert.equal(f.children.length,1);const saved=JSON.parse(await readFile(join(f.dir,'market-accounts.json'),'utf8'));assert.deepEqual(saved.symbols,['SHFE.rb2701']);
  }finally{await f.close();}
});
