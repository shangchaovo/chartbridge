import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VENUES = ['BINANCE', 'NASDAQ', 'NYSE', 'AMEX', 'SSE', 'SZSE', 'HKEX', 'TVC', 'FX', 'SP', 'BATS', 'COINBASE', 'BITSTAMP', 'OANDA'];

// Read complete watchlist responses from Chromium's HTTP cache. Fragments from
// history and chart state are deliberately kept separate from saved watchlists.
export function extractWatchlists(text) {
  const source = String(text || '');
  const lists = [];
  for (const match of source.matchAll(/"symbols"\s*:\s*\[/g)) {
    const start = source.lastIndexOf('{', match.index);
    if (start < 0 || match.index - start > 4096) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < Math.min(source.length, start + 200000); end++) {
      const char = source[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(source.slice(start, end + 1));
          if (value.id && typeof value.name === 'string' && ['custom', 'colored'].includes(value.type) &&
              Array.isArray(value.symbols) && value.symbols.every(symbol => typeof symbol === 'string')) {
            lists.push({ id: String(value.id), name: value.name, type: value.type, active: value.active === true,
              modified: value.modified || null, symbols: value.symbols.filter(symbol => !symbol.startsWith('###')) });
          }
        } catch { /* Ignore incomplete cache blocks. */ }
        break;
      }
    }
  }
  return lists;
}

function scanWatchlistCache(dir) {
  if (!existsSync(dir)) return [];
  const latest = new Map();
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  for (const name of names) {
    if (!/^(?:data_[0-3]|f_[a-f0-9]+|[a-f0-9]{16}_[0-1])$/i.test(name)) continue;
    const path = join(dir, name);
    try {
      if (statSync(path).size > 16_000_000) continue;
      const bytes = readFileSync(path);
      for (const list of extractWatchlists(bytes.toString('utf8'))) {
        const old = latest.get(list.id);
        if (!old || (Date.parse(list.modified) || 0) >= (Date.parse(old.modified) || 0)) latest.set(list.id, { ...list, source: path });
      }
    } catch { /* A running browser may replace a cache block while it is read. */ }
  }
  return [...latest.values()];
}

export function extractChartFragments(text) {
  const source = String(text || '');
  const symbols = [];
  const venue = VENUES.join('|');
  const add = value => { if (value && !symbols.includes(value) && symbols.length < 150) symbols.push(value); };
  for (const match of source.matchAll(new RegExp(`(?:${venue}):[A-Z0-9.]{1,24}`, 'g'))) add(match[0]);
  for (const match of source.matchAll(new RegExp(`(?:${venue})%3A[A-Z0-9.]{1,24}`, 'gi'))) {
    try { add(decodeURIComponent(match[0])); } catch { /* skip a broken escape */ }
  }
  const indicators = [];
  const studyText = (source.match(/studyId.{0,80}|shortDescription.{0,80}|"type"\s*:\s*"Study".{0,160}/gi) || []).join('\n');
  const known = [[/\bRSI\b|Relative Strength/i, 'RSI'], [/\bMACD\b/i, 'MACD'], [/Bollinger|\bBOLL\b/i, 'BOLL'], [/\bEMA\b|Exponential Moving/i, 'EMA'], [/\bSMA\b|\bMA\b|Moving Average/i, 'MA'], [/\bVOL\b|\bVolume\b/i, 'VOL']];
  if (studyText) for (const [pattern, name] of known) if (pattern.test(studyText) && !indicators.includes(name)) indicators.push(name);
  const ignored = [];
  if (/watchlist/i.test(source)) ignored.push('自选编号');
  return { symbols, indicators, ignored };
}

function windowsAround(text, needle, radius = 12000) {
  const lower = text.toLowerCase();
  const key = needle.toLowerCase();
  const parts = [];
  let from = 0;
  while (parts.length < 30) {
    const index = lower.indexOf(key, from);
    if (index < 0) break;
    parts.push(text.slice(Math.max(0, index - radius), index + radius));
    from = index + key.length;
  }
  return parts.join('\n');
}

function absorbFile(path, bucket, { window = false } = {}) {
  let size = 0;
  try { size = statSync(path).size; } catch { return; }
  if (!size || size > 8_000_000) return;
  const raw = readFileSync(path).toString('latin1');
  const text = window ? windowsAround(raw, 'tradingview.com') : raw;
  if (!text) return;
  const found = extractChartFragments(text);
  if (found.symbols.length || found.indicators.length || found.ignored.length) bucket.sources.push(path);
  bucket.chunks.push(found);
}

function absorbDir(dir, bucket, options = {}) {
  bucket.searched.push({ path: dir, exists: existsSync(dir) });
  if (!existsSync(dir)) return;
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (/cookie|login data|web data/i.test(name)) continue;
    const path = join(dir, name);
    let info;
    try { info = statSync(path); } catch { continue; }
    if (info.isDirectory()) {
      if (/tradingview/i.test(name) || options.recurse) absorbDir(path, bucket, options);
      continue;
    }
    if (/\.(ldb|log|json)$/i.test(name)) absorbFile(path, bucket, options);
  }
}

export function scanTradingViewLocal(env = process.env, { listId } = {}) {
  const appdata = env.APPDATA || '';
  const local = env.LOCALAPPDATA || '';
  const bucket = { searched: [], sources: [], chunks: [] };
  const roaming = join(appdata, 'TradingView');
  const watchlists = scanWatchlistCache(join(roaming, 'Cache', 'Cache_Data'));
  const selected = listId ? watchlists.find(list => list.id === String(listId)) :
    watchlists.find(list => list.name === 'STOCK') || watchlists.filter(list => list.active).sort((a,b) => (Date.parse(b.modified)||0)-(Date.parse(a.modified)||0))[0];
  bucket.searched.push({ path: roaming, exists: existsSync(roaming) });
  absorbDir(join(roaming, 'Local Storage', 'leveldb'), bucket);
  absorbDir(join(roaming, 'IndexedDB'), bucket, { recurse: true });
  bucket.searched.push({ path: join(roaming, 'TVUserStorage'), exists: existsSync(join(roaming, 'TVUserStorage')) });
  bucket.searched.push({ path: join(local, 'TradingView'), exists: existsSync(join(local, 'TradingView')) });
  for (const browser of [['Google', 'Chrome'], ['Microsoft', 'Edge']]) {
    const userData = join(local, ...browser, 'User Data');
    bucket.searched.push({ path: userData, exists: existsSync(userData) });
    if (!existsSync(userData)) continue;
    let profiles = [];
    try { profiles = readdirSync(userData); } catch { continue; }
    for (const profile of profiles) {
      if (!/^(Default|Profile \d+)$/.test(profile)) continue;
      const indexed = join(userData, profile, 'IndexedDB');
      if (!existsSync(indexed)) {
        bucket.searched.push({ path: indexed, exists: false });
        continue;
      }
      let databases = [];
      try { databases = readdirSync(indexed); } catch { continue; }
      const hits = databases.filter(name => /tradingview/i.test(name));
      if (!hits.length) bucket.searched.push({ path: indexed, exists: true });
      for (const name of hits) absorbDir(join(indexed, name), bucket);
      const storage = join(userData, profile, 'Local Storage', 'leveldb');
      absorbDir(storage, bucket, { window: true });
    }
  }
  const symbols = [];
  const indicators = [];
  const ignored = new Set();
  for (const chunk of bucket.chunks) {
    for (const symbol of chunk.symbols) if (!symbols.includes(symbol)) symbols.push(symbol);
    for (const name of chunk.indicators) if (!indicators.includes(name)) indicators.push(name);
    for (const item of chunk.ignored) ignored.add(item);
  }
  if (!indicators.length) ignored.add('指标参数');
  const home = env.USERPROFILE || env.HOME || '';
  const redact = value => {
    const text = String(value || '');
    if (home && text.toLowerCase().startsWith(home.toLowerCase())) return text.slice(home.length).replace(/^[/\\]+/, '') || '本机目录';
    return text;
  };
  return {
    searched: bucket.searched.map(item => ({ ...item, path: redact(item.path) })),
    sources: selected ? [redact(selected.source)] : bucket.sources.map(redact),
    symbols: selected?.symbols || [],
    indicators: [],
    watchlists: watchlists.map(({ source, ...list }) => list),
    selectedWatchlist: selected ? { id: selected.id, name: selected.name, modified: selected.modified } : null,
    fragments: { symbols, indicators },
    ignored: selected ? [] : ['没有完整的自选清单；历史记录片段未作为自选导入。'],
    found: Boolean(selected?.symbols.length),
  };
}
