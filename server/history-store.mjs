import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const empty = () => ({ exhausted: false, oldest: null, newest: null, count: 0, updatedAt: 0, chunks: [] });

function safeSymbol(symbol) {
  const safe = String(symbol || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(safe)) throw new Error('缓存代码无效。');
  return safe;
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}

function dedupe(bars) {
  const map = new Map();
  for (const bar of bars || []) {
    const timestamp = Number(bar?.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    map.set(timestamp, { ...bar, timestamp });
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Chunked on-disk candles. A read loads only the chunks needed for one bounded window. */
export function createHistoryStore(root, { chunkSize = 5000 } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 2 || chunkSize > 5000) throw new Error('缓存分块大小无效。');
  const pending = new Map();
  function serialized(symbol, interval, task) {
    const key = folderOf(symbol, interval);
    const previous = pending.get(key) || Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => {});
    pending.set(key, tail);
    void tail.then(() => { if (pending.get(key) === tail) pending.delete(key); });
    return run;
  }
  function newestQuote(incoming, saved) {
    if (!incoming) return saved || null;
    if (Number.isFinite(saved?.timestamp) && (!Number.isFinite(incoming.timestamp) || incoming.timestamp < saved.timestamp)) return saved;
    return incoming;
  }
  function folderOf(symbol, interval) {
    if (!/^[0-9A-Za-z]{1,4}$/.test(interval)) throw new Error('缓存周期无效。');
    return join(root, safeSymbol(symbol), interval);
  }
  async function readMeta(folder) {
    try { return JSON.parse(await readFile(join(folder, 'meta.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function stat(symbol, interval) {
    return await readMeta(folderOf(symbol, interval)) || empty();
  }
  async function writeMeta(folder, meta) {
    await mkdir(folder, { recursive: true });
    await atomicWrite(join(folder, 'meta.json'), meta);
    return meta;
  }
  async function markExhausted(symbol, interval) {
    const folder = folderOf(symbol, interval);
    const meta = await readMeta(folder) || empty();
    meta.exhausted = true;
    meta.updatedAt = Date.now();
    return writeMeta(folder, meta);
  }
  async function merge({ symbol, interval, bars, exhausted = false, quote = null, feed = null }) {
    const incoming = dedupe(bars);
    const folder = folderOf(symbol, interval);
    await mkdir(folder, { recursive: true });
    const meta = await readMeta(folder) || empty();
    if (!incoming.length) {
      if (exhausted) meta.exhausted = true;
      meta.updatedAt = Date.now();
      if (quote) meta.quote = newestQuote(quote, meta.quote);
      if (feed) meta.feed = feed;
      return writeMeta(folder, meta);
    }
    const from = incoming[0].timestamp;
    const to = incoming.at(-1).timestamp;
    const touching = meta.chunks.filter(chunk => chunk.to >= from && chunk.from <= to
      || (chunk === meta.chunks[0] && to < chunk.from)
      || (chunk === meta.chunks.at(-1) && from > chunk.to));
    const loaded = [];
    for (const chunk of touching) {
      loaded.push(...JSON.parse(await readFile(join(folder, chunk.file), 'utf8')));
    }
    const combined = dedupe([...loaded, ...incoming]);
    for (const chunk of touching) await rm(join(folder, chunk.file), { force: true });
    const replacements = [];
    for (let index = 0; index < combined.length; index += chunkSize) {
      const slice = combined.slice(index, index + chunkSize);
      const file = `c-${slice[0].timestamp}-${slice.at(-1).timestamp}.json`;
      await atomicWrite(join(folder, file), slice);
      replacements.push({ file, from: slice[0].timestamp, to: slice.at(-1).timestamp, count: slice.length });
    }
    const rest = meta.chunks.filter(chunk => !touching.includes(chunk));
    const chunks = [...rest, ...replacements].sort((a, b) => a.from - b.from);
    const next = {
      symbol, interval, exhausted: Boolean(meta.exhausted || exhausted), updatedAt: Date.now(),
      count: chunks.reduce((sum, chunk) => sum + chunk.count, 0),
      oldest: chunks[0]?.from ?? null, newest: chunks.at(-1)?.to ?? null,
      quote: newestQuote(quote, meta.quote), feed: feed || meta.feed || null, chunks,
    };
    return writeMeta(folder, next);
  }
  async function read({ symbol, interval, before = null, limit }) {
    const meta = await readMeta(folderOf(symbol, interval));
    if (!meta?.chunks?.length) return { candles: [], complete: false, exhausted: false, updatedAt: 0, quote: null, feed: null, oldest: null, newest: null, count: 0 };
    const parts = [];
    let seen = 0;
    for (let index = meta.chunks.length - 1; index >= 0 && seen < limit; index -= 1) {
      const chunk = meta.chunks[index];
      if (before != null && chunk.from >= before) continue;
      const bars = JSON.parse(await readFile(join(folderOf(symbol, interval), chunk.file), 'utf8'));
      const usable = before == null ? bars : bars.filter(bar => bar.timestamp < before);
      if (!usable.length) continue;
      parts.push(usable);
      seen += usable.length;
    }
    const candles = parts.reverse().flat().slice(-limit);
    const oldest = meta.oldest;
    const reachedOrigin = Boolean(meta.exhausted) && (candles.length === 0 || candles[0]?.timestamp === oldest || (before != null && before <= oldest));
    return {
      candles, complete: candles.length >= limit || reachedOrigin, exhausted: reachedOrigin,
      updatedAt: meta.updatedAt || 0, quote: meta.quote || null, feed: meta.feed || null,
      oldest, newest: meta.newest, count: meta.count,
    };
  }
  return { stat,
    merge: args => serialized(args.symbol, args.interval, () => merge(args)),
    read: args => serialized(args.symbol, args.interval, () => read(args)),
    markExhausted: (symbol, interval) => serialized(symbol, interval, () => markExhausted(symbol, interval)),
  };
}
