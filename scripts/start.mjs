import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/start.mjs [--lan] [--dev] [--no-open] [--background]');
  process.exit(0);
}
if (args.some(arg => !['--lan', '--dev', '--no-open', '--background'].includes(arg))) {
  console.error('未知启动参数。使用 --help 查看支持的选项。'); process.exit(1);
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  console.error('需要 Node.js 22.19+，也可安装当前 Node.js LTS。'); process.exit(1);
}
const host = args.includes('--lan') ? '0.0.0.0' : process.env.TERMINAL_HOST || '127.0.0.1';
const port = Number(process.env.TERMINAL_PORT || 18765);
if (!['127.0.0.1', '0.0.0.0'].includes(host) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('TERMINAL_HOST / TERMINAL_PORT 无效。'); process.exit(1);
}
let networkEnv = {};
const networkPath = join(root, 'work', 'network-env.json');
if (existsSync(networkPath)) {
  try {
    const saved = JSON.parse(readFileSync(networkPath, 'utf8'));
    const allowed = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY']);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.entries(saved).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || value.length > 2048)) throw new Error();
    networkEnv = saved;
  } catch { console.error('本机 work/network-env.json 格式无效。'); process.exit(1); }
}
const env = { ...process.env, ...networkEnv, TERMINAL_HOST: host, TERMINAL_PORT: String(port) };
const url = `http://127.0.0.1:${port}/`;
function openBrowser() {
  if (args.includes('--no-open') || args.includes('--background')) return;
  const command = process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}
let existing;
try { existing = await (await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1500) })).json(); } catch {}
if (existing) {
  if (existing.app !== 'shanhai-market-terminal') { console.error(`端口 ${port} 正被其他程序使用。`); process.exit(1); }
  if (host === '0.0.0.0' && existing.mode !== 'lan') { console.error('本机模式已在运行；先停止原服务，再启用局域网模式。'); process.exit(1); }
  console.log(`山海终端已在运行：${url}`); openBrowser(); process.exit(0);
}

mkdirSync(join(root, 'work'), { recursive: true });
const background = args.includes('--background');
const log = background ? openSync(join(root, 'work', 'server.log'), 'a') : null;
const stdio = background ? ['ignore', log, log] : 'inherit';
function run(command, parameters, extra = {}) {
  const result = spawnSync(command, parameters, { cwd: root, env, stdio, windowsHide: background, ...extra });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `启动准备失败：${command}（${result.status}）`);
    if (log !== null) closeSync(log); process.exit(result.status || 1);
  }
}
const packages = ['pinets', 'klinecharts', '@modelcontextprotocol/server', '@modelcontextprotocol/node', 'ws', 'zod'];
if (packages.some(name => !existsSync(join(root, 'node_modules', name, 'package.json')))) {
  console.log('正在安装本机自己的依赖…');
  if (process.platform === 'win32') {
    // This command is constant; user parameters never enter cmd.exe text.
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --cache .npm-cache --ignore-scripts --no-fund --no-audit']);
  } else run('npm', ['ci', '--cache', '.npm-cache', '--ignore-scripts', '--no-fund', '--no-audit']);
}
const development = args.includes('--dev');
if (!development) run(process.execPath, [join(root, 'scripts', 'build.mjs')]);
const server = spawn(process.execPath, [join(root, development ? 'scripts/dev.mjs' : 'server/index.mjs')], { cwd: root, env, stdio, windowsHide: background });
if (log !== null) closeSync(log);
console.log(`山海终端：${url}（${host === '0.0.0.0' ? 'LAN / Tailscale' : '本机'}）`);
let finished = false;
server.once('error', error => { console.error(error.message); process.exitCode = 1; finished = true; });
server.once('exit', code => { finished = true; process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!finished) server.kill(signal); });
for (let attempt = 0; attempt < 40 && !finished; attempt++) {
  try {
    const health = await (await fetch(`${url}api/health`, { signal: AbortSignal.timeout(500) })).json();
    if (health.app === 'shanhai-market-terminal') { openBrowser(); break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
