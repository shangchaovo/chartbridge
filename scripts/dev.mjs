import { watch } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = () => spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
if (build().status !== 0) process.exit(1);
const server = spawn(process.execPath, ['--watch', resolve(root, 'server/index.mjs')], { cwd: root, stdio: 'inherit' });
let timer;
const changed = () => { clearTimeout(timer); timer = setTimeout(build, 200); };
const watchers = [watch(resolve(root, 'src'), { recursive: true }, changed), watch(resolve(root, 'index.html'), changed)];
console.log('已监听 src/ 与 index.html；后端修改自动重启，前端修改后刷新浏览器。');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for(const watcher of watchers)watcher.close(); server.kill(signal); process.exit(); });
