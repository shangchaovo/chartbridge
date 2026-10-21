import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {workspaceSettings,sameSetting} from '../src/workspace-settings.js';

// A transaction commits current state and its previous version together. This
// avoids replacing a JSON file that Windows sync/indexing software may hold open.
export class WorkspaceStore extends EventEmitter{
  constructor(path){
    super();
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS workspace_settings_batches (id TEXT PRIMARY KEY, hash TEXT NOT NULL, revision INTEGER NOT NULL)');
  }
  setChartSource(source){this.chartSource=source;}
  read(fallback={}){const row=this.db.prepare("SELECT value FROM workspace WHERE id='current'").get();const value=row?JSON.parse(row.value):structuredClone(fallback);return value&&this.chartSource?{...value,...this.chartSource()}:value;}
  previous(){const row=this.db.prepare("SELECT value FROM workspace WHERE id='previous'").get();return row?JSON.parse(row.value):null;}
  settings(){
    const row=this.db.prepare("SELECT value FROM workspace WHERE id='settings'").get();
    return row?JSON.parse(row.value):{revision:0,initialized:false,source:null,fields:workspaceSettings(this.read()),preferences:{}};
  }
  settingsBatch(id){return this.db.prepare('SELECT hash,revision FROM workspace_settings_batches WHERE id=?').get(id);}
  write(value,settingsPatch={},receipt=null){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('工作区必须是 JSON 对象。');
    // Chart fields are owned by the versioned room. Legacy full-workspace PUTs
    // may still update personal settings, but cannot restore old locks/geometry.
    if(this.chartSource)value={...value,...this.chartSource()};
    const json=JSON.stringify(value);
    const prior=this.settings(),next={...prior,...settingsPatch,fields:workspaceSettings(value)};
    const changed=!sameSetting({...prior,revision:0},{...next,revision:0});
    next.revision=prior.revision+(changed?1:0);
    const settingsJson=JSON.stringify(next);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.exec("INSERT INTO workspace (id,value) SELECT 'previous',value FROM workspace WHERE id='current' ON CONFLICT(id) DO UPDATE SET value=excluded.value");
      this.db.prepare("INSERT INTO workspace (id,value) VALUES ('current',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(json);
      this.db.prepare("INSERT INTO workspace (id,value) VALUES ('settings',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(settingsJson);
      if(receipt)this.db.prepare('INSERT INTO workspace_settings_batches (id,hash,revision) VALUES (?,?,?)').run(receipt.id,receipt.hash,next.revision);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(changed)this.emit('settings',next);
  }
  close(){this.db.close();}
}
export async function openWorkspaceStore(dataDir){
  const store=new WorkspaceStore(join(dataDir,'workspace.sqlite'));
  try{
    if(store.read(null)===null){
      let seed={};
      for(const name of ['workspace.json','workspace.previous.json']){
        try{const value=JSON.parse(await readFile(join(dataDir,name),'utf8'));if(value&&typeof value==='object'&&!Array.isArray(value)){seed=value;break;}}
        catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
      }
      store.write(seed);
    }
    return store;
  }catch(error){store.close();throw error;}
}
