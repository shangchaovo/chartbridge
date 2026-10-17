import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchKLineCharts } from './patch-klinecharts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
await mkdir(join(dist, 'vendor'), { recursive: true });
await cp(join(root, 'src'), join(dist, 'src'), { recursive: true });
const chart = await readFile(join(root, 'node_modules/klinecharts/dist/index.esm.js'), 'utf8');
await writeFile(join(dist, 'vendor/klinecharts.js'), patchKLineCharts(chart).replaceAll('process.env.NODE_ENV', '"production"'));
await cp(join(root, 'node_modules/pinets/dist/pinets.min.browser.es.js'), join(dist, 'vendor/pinets.js'));
let main = await readFile(join(dist, 'src/main.js'), 'utf8');
main = main.replace("import './style.css';", '').replace("from 'klinecharts'", "from '/vendor/klinecharts.js'");
await writeFile(join(dist, 'src/main.js'), main);
let pine = await readFile(join(dist, 'src/pine-runtime.js'), 'utf8');
await writeFile(join(dist, 'src/pine-runtime.js'), pine.replace("from 'pinets'", "from '/vendor/pinets.js'"));
const html = await readFile(join(root, 'index.html'), 'utf8');
await writeFile(join(dist, 'index.html'), html.replace('</head>', '  <link rel="stylesheet" href="/src/style.css" />\n</head>'));
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  try { await cp(join(root, name), join(dist, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await cp(join(root, 'licenses'), join(dist, 'licenses'), { recursive: true });
console.log('本地资源已生成：dist/（无远程 CDN、无需二进制构建工具）');
