// History is scoped to symbol + interval and contains only user drawings.
const clean = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(clean) :
  Object.fromEntries(Object.keys(value).sort().filter(key => !['author','updatedAt'].includes(key)).map(key => [key,clean(value[key])])) : value;
const same = (a,b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
export class DrawingHistory {
  constructor(limit=80) {this.limit=limit;this.entries=new Map();}
  reset(key,drawings=[]) {this.entries.set(key,{snapshots:[structuredClone(drawings)],index:0});}
  observe(key,drawings=[]) {
    const entry=this.entries.get(key);
    if(!entry || !same(entry.snapshots[entry.index],drawings)) this.reset(key,drawings);
  }
  record(key,drawings) {
    const entry=this.entries.get(key);
    if(!entry){this.reset(key,drawings);return;}
    if(same(entry.snapshots[entry.index],drawings))return;
    entry.snapshots.splice(entry.index+1);
    entry.snapshots.push(structuredClone(drawings));
    if(entry.snapshots.length>this.limit+1)entry.snapshots.shift();
    entry.index=entry.snapshots.length-1;
  }
  canUndo(key) {return (this.entries.get(key)?.index||0)>0;}
  canRedo(key) {const e=this.entries.get(key);return Boolean(e&&e.index<e.snapshots.length-1);}
  undo(key) {const e=this.entries.get(key);return this.canUndo(key)?structuredClone(e.snapshots[--e.index]):null;}
  redo(key) {const e=this.entries.get(key);return this.canRedo(key)?structuredClone(e.snapshots[++e.index]):null;}
}
