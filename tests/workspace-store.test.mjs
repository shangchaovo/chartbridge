import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openWorkspaceStore,WorkspaceStore} from '../server/workspace-store.mjs';
import {mergeSavedWatchlist,readWatchlistBackup,writeWatchlistBackup,WATCHLIST_STORAGE_KEY} from '../src/watchlist-state.js';

async function directory(t){const dir=await mkdtemp(join(tmpdir(),'chartbridge-workspace-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('workspace migrates legacy JSON once and survives close/reopen without replacing the legacy file',async t=>{
  const dir=await directory(t),legacy={schemaVersion:1,watchlist:['AAPL','BINANCE:TSLAUSDT'],alerts:[{id:'a',firedAt:10}]};
  await writeFile(join(dir,'workspace.json'),JSON.stringify(legacy));
  let store=await openWorkspaceStore(dir);assert.deepEqual(store.read(),legacy);
  const next={...legacy,watchlist:['BINANCE:TSLAUSDT','COINBASE:BTCUSD']};store.write(next);assert.deepEqual(store.previous(),legacy);store.close();
  // Even a stale or corrupted migration file cannot reset committed data.
  await writeFile(join(dir,'workspace.json'),'broken JSON');store=await openWorkspaceStore(dir);
  assert.deepEqual(store.read(),next);assert.deepEqual(store.previous(),legacy);assert.equal(await readFile(join(dir,'workspace.json'),'utf8'),'broken JSON');store.close();
});
test('a damaged initial JSON recovers from the previous workspace without discarding its watchlist',async t=>{
  const dir=await directory(t);await writeFile(join(dir,'workspace.json'),'broken');await writeFile(join(dir,'workspace.previous.json'),JSON.stringify({watchlist:['MSFT']}));
  const store=await openWorkspaceStore(dir);assert.deepEqual(store.read().watchlist,['MSFT']);store.close();
});
test('workspace rejects unencodable state before changing current or previous data',()=>{
  const store=new WorkspaceStore(':memory:');try{store.write({watchlist:['AAPL']});const cyclic={};cyclic.self=cyclic;assert.throws(()=>store.write(cyclic));assert.throws(()=>store.write([]));assert.deepEqual(store.read(),{watchlist:['AAPL']});assert.equal(store.previous(),null);}finally{store.close();}
});
test('stale tab autosaves preserve newer saved additions and removals',()=>{
  const base=['AAPL','MSFT'];assert.deepEqual(mergeSavedWatchlist(base,base,['AAPL','TSLA']),['AAPL','TSLA']);
  assert.deepEqual(mergeSavedWatchlist(base,[...base,'NVDA'],['AAPL','TSLA']),['AAPL','NVDA','TSLA']);
  assert.deepEqual(mergeSavedWatchlist(base,['MSFT'],['AAPL','MSFT','TSLA']),['MSFT','TSLA']);
});
test('watchlist merge keeps intentional ordering and clearing, while legacy saves preserve missing items',()=>{
  assert.deepEqual(mergeSavedWatchlist(['AAPL','MSFT'],['MSFT','AAPL'],['AAPL','MSFT','TSLA']),['MSFT','AAPL','TSLA']);
  assert.deepEqual(mergeSavedWatchlist(['AAPL','MSFT'],[],['AAPL','MSFT']),[]);
  assert.deepEqual(mergeSavedWatchlist([],['AAPL'],['AAPL','MSFT']),['AAPL','MSFT']);
  assert.throws(()=>mergeSavedWatchlist([],['AAPL'],Array.from({length:150},(_,i)=>`S${i}`)),/150/);
});
test('immediate browser backup preserves pending membership and its base for reload recovery',()=>{
  const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
  assert.equal(writeWatchlistBackup(storage,['MSFT','TSLA'],{pending:true,base:['AAPL','MSFT']}),true);
  const recovered=readWatchlistBackup(storage);assert.deepEqual(mergeSavedWatchlist(recovered.base,recovered.watchlist,['AAPL','MSFT','NVDA']),['MSFT','TSLA','NVDA']);
  writeWatchlistBackup(storage,[],{pending:true,base:['MSFT','TSLA']});assert.deepEqual(readWatchlistBackup(storage).watchlist,[]);
  storage.setItem(WATCHLIST_STORAGE_KEY,'broken');assert.equal(readWatchlistBackup(storage),null);
  assert.equal(writeWatchlistBackup({setItem(){throw new Error('quota');}},['AAPL']),false);
});
