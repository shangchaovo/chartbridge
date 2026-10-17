import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveStaticPath } from '../server/static-path.mjs';

for (const [name, paths, root] of [['macOS',path.posix,'/project/dist'],['Windows',path.win32,'D:\\Projects\\shanhai\\dist']]) {
  test(`${name}: serve root, nested modules and Unicode filenames within dist`, () => {
    assert.equal(resolveStaticPath(root,'/',paths),paths.join(root,'index.html'));
    assert.equal(resolveStaticPath(root,'/src/main.js',paths),paths.join(root,'src','main.js'));
    assert.equal(resolveStaticPath(root,'/images/山海.svg',paths),paths.join(root,'images','山海.svg'));
  });
  test(`${name}: reject traversal and sibling directories sharing the dist prefix`, () => {
    for(const value of ['/../package.json','/../../secret','/../dist-other/private','/src/../../private']) assert.throws(()=>resolveStaticPath(root,value,paths),{status:403});
    assert.throws(()=>resolveStaticPath(root,'/bad\0file',paths),{status:400});
    if(name==='Windows')assert.throws(()=>resolveStaticPath(root,'/..\\..\\secret',paths),{status:403});
  });
}
