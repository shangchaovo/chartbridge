import { runPineScript } from './pine-runtime.js';

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
  try { Object.defineProperty(globalThis, name, { value: () => { throw new Error('Pine 工作线程不能访问网络。'); }, writable: false, configurable: false }); } catch {}
}
self.onmessage = async event => {
  try { self.postMessage(await runPineScript(event.data)); }
  catch (error) { self.postMessage({ ok: false, error: error.message || String(error), plots: [], markers: [], warnings: [] }); }
};
