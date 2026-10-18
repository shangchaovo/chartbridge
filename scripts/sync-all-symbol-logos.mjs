// Explicit maintenance command: public metadata in, verified local assets out.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SYMBOL_CATALOG } from '../server/market-data.mjs';
import { FUTURES_CATALOG } from '../server/public-feeds.mjs';
import { mergeCatalog, enrichBinanceAssets } from '../server/public-catalog.mjs';

const root = new URL('../src/assets/logos/', import.meta.url);
await mkdir(root, { recursive: true });
const read = async (url, fallback) => { try { return JSON.parse(await readFile(url, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } };
const live = await read(new URL('../data/public-catalog.json', import.meta.url), {});
const imported = await read(new URL('../data/watchlist-instruments.json', import.meta.url), []);
const workspace = await read(new URL('../data/workspace.json', import.meta.url), {});
const old = await read(new URL('sources.json', root), { assets: [], symbols: {} });
const assetSource = 'https://www.binance.com/bapi/asset/v2/public/asset/asset/get-all-asset';
const assetResponse = await fetch(assetSource, { signal: AbortSignal.timeout(25000) });
if (!assetResponse.ok) throw new Error(`Binance asset directory: HTTP ${assetResponse.status}`);
const assetPayload = await assetResponse.json();
if (!Array.isArray(assetPayload?.data) || !assetPayload.data.length) throw new Error('Invalid Binance asset directory');
const binanceAssets = new Map(assetPayload.data.map(item => [item.assetCode, item]));
const rows = enrichBinanceAssets(mergeCatalog([...SYMBOL_CATALOG, ...FUTURES_CATALOG, ...imported], live.results || []), assetPayload);
if (live.results?.length) await writeFile(new URL('../data/public-catalog.json', import.meta.url), JSON.stringify({ ...live, results: enrichBinanceAssets(live.results, assetPayload) }));
for (const symbol of workspace.watchlist || []) if (!rows.some(row => row.symbol === symbol)) rows.push({ symbol, name: symbol, market: 'us', type: 'stock', provider: 'yahoo' });
const bySymbol = new Map(rows.map(row => [row.symbol, row]));
const indices = { '^GSPC': 'SP:SPX', '^IXIC': 'NASDAQ:IXIC', '^DJI': 'DJ:DJI', '^HSI': 'HSI:HSI', '000001.SS': 'SSE:000001', '399001.SZ': 'SZSE:399001', '000300.SS': 'SSE:000300', '000016.SS': 'SSE:000016', '000905.SS': 'SSE:000905', '000688.SS': 'SSE:000688', '399006.SZ': 'SZSE:399006', '^HSCE': 'HSI:HSCEI', '^NDX': 'NASDAQ:NDX', '^VIX': 'CBOE:VIX', '^FTSE': 'FTSE:UKX', '^GDAXI': 'XETR:DAX', '^FCHI': 'EURONEXT:PX1', '^N225': 'TVC:NI225', '^KS11': 'KRX:KOSPI', '^TWII': 'TWSE:TAIEX', '^AXJO': 'ASX:XJO' };
const aliases = new Map();
function stockTickers(symbol, row = bySymbol.get(symbol)) {
  if (row?.market === 'hk') return [`HKEX:${Number(symbol.split('.')[0])}`];
  if (row?.market === 'cn') return [`${row.exchange}:${symbol.split('.')[0]}`];
  if (symbol === 'BRK-B') return ['NYSE:BRK.B'];
  if (symbol === 'WMT') return ['NASDAQ:WMT'];
  if (symbol === 'ARKK') return ['CBOE:ARKK'];
  const venue = row?.exchange === 'NYSE ARCA' ? 'AMEX' : row?.exchange;
  return [...new Set([venue && `${venue}:${symbol}`, `NASDAQ:${symbol}`, `NYSE:${symbol}`, `AMEX:${symbol}`, `BATS:${symbol}`].filter(Boolean))];
}
for (const row of rows) {
  let tickers = [];
  if (indices[row.symbol]) tickers = [indices[row.symbol]];
  else if (row.market === 'us-binance' || row.market === 'binance-perp') {
    const stock = row.underlyingSymbol || row.symbol.replace(/^BINANCE:/, '').replace(/(?:USDT|USDC|USD1)$/, '');
    tickers = [row.provider === 'binance-perp' ? `${row.symbol}.P` : `BINANCE:${row.symbol}`, ...stockTickers(stock)];
  } else if (['us', 'hk', 'cn'].includes(row.market)) tickers = stockTickers(row.symbol, row);
  else if (row.market === 'crypto') {
    const code = row.symbol.replace(/^(?:OKX|KRAKEN|BINANCE-SPOT|COINBASE):/, '').replace(/[-/]/g, '');
    tickers = [row.provider === 'binance-perp' || row.provider === 'binance-coinm' ? `${row.symbol}.P` :
      row.symbol.startsWith('COINBASE:') ? row.symbol : `${row.exchange}:${code}`];
  } else if (row.symbol.startsWith('PYTH:')) tickers = [row.symbol];
  if (tickers.length) aliases.set(row.symbol, [...new Set(tickers)]);
}
aliases.set('BINANCE:KODEX200USDT', ['KRX:069500', ...aliases.get('BINANCE:KODEX200USDT') || []]);
aliases.set('BINANCE:HK0625USDT', ['HKEX:625', ...aliases.get('BINANCE:HK0625USDT') || []]);
aliases.set('^TWII', ['TWSE:IX0001']);
const metadata = new Map(), tickers = [...new Set([...aliases.values()].flat())];
for (let index = 0; index < tickers.length; index += 80) {
  const response = await fetch('https://scanner.tradingview.com/global/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: { tickers: tickers.slice(index, index + 80), query: { types: [] } }, columns: ['name', 'logoid', 'base_currency_logoid'] }), signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`Public symbol metadata: HTTP ${response.status}`);
  const result = await response.json();
  for (const item of result.data || []) metadata.set(item.s, { ticker: item.s, logo: item.d[1] || item.d[2] || null });
  if (index % 400 === 0) console.log(JSON.stringify({ phase: 'metadata', done: Math.min(index + 80, tickers.length), total: tickers.length }));
}
const chosen = new Map();
for (const [symbol, candidates] of aliases) {
  const match = candidates.map(ticker => metadata.get(ticker)).find(item => item?.logo);
  if (match) chosen.set(symbol, match);
}
const assets = new Map((old.assets || []).map(asset => [asset.logo, asset]));
const files = new Map(), failures = [];
const unique = [...new Set([...chosen.values()].map(item => item.logo))];
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < unique.length) {
    const logo = unique[next++];
    const cached = assets.get(logo);
    if (cached) { try { await access(new URL(cached.file, root)); files.set(logo, cached.file); continue; } catch {} }
    const url = `https://s3-symbol-logo.tradingview.com/${logo}--big.svg`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const svg = await response.text();
      if (svg.length > 300000 || !/<svg\b/i.test(svg) || /<(?:script|foreignObject)\b|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)|\bon\w+\s*=/i.test(svg)) throw new Error('Unexpected SVG content');
      const file = `tv-${createHash('sha256').update(logo).digest('hex').slice(0,16)}.svg`;
      await writeFile(new URL(file, root), svg); files.set(logo, file);
      assets.set(logo, { logo, file, url, sha256: createHash('sha256').update(svg).digest('hex') });
    } catch (error) { failures.push({ logo, error: error.message }); }
  }
}));
const logos = Object.fromEntries(Object.entries(old.symbols || {}).filter(([, value]) => value.file).map(([symbol, value]) => [symbol, value.file]));
const manifestSymbols = { ...old.symbols };
for (const row of rows) {
  const choice = chosen.get(row.symbol), file = choice && files.get(choice.logo);
  if (file) logos[row.symbol] = file;
  manifestSymbols[row.symbol] = { ticker: choice?.ticker || aliases.get(row.symbol)?.[0] || null, logo: choice?.logo || null, file: file || logos[row.symbol] || null };
}
// The exchange's asset directory is authoritative for new tokens absent from the chart vendor.
for (const row of rows.filter(item => !logos[item.symbol])) {
  const base = row.baseAsset || row.symbol.replace(/^.*:/, '').replace(/[-/]/g, '').replace(/(?:FDUSD|USDT|USDC|USD1|USD)$/, '');
  const asset = binanceAssets.get(base) || (/^1000(?:SHIB|FLOKI|RATS)$/.test(base) && binanceAssets.get(base.slice(4))) ||
    (row.market === 'us-binance' && binanceAssets.get(`${base}B`));
  const url = asset?.logoUrl;
  if (!url || !/^https:\/\/bin\.bnbstatic\.com\//.test(url)) continue;
  const logo = `binance:${asset.assetCode}`;
  try {
    let cached = assets.get(logo);
    if (cached) { try { await access(new URL(cached.file, root)); } catch { cached = null; } }
    if (!cached) {
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
      if (bytes.length > 1000000 || (!png && !webp)) throw new Error('Unexpected raster format');
      const file = `bn-${createHash('sha256').update(logo).digest('hex').slice(0,16)}.${png ? 'png' : 'webp'}`;
      await writeFile(new URL(file, root), bytes);
      cached = { logo, file, url, sha256: createHash('sha256').update(bytes).digest('hex') }; assets.set(logo, cached);
    }
    logos[row.symbol] = cached.file;
    manifestSymbols[row.symbol] = { ticker: row.symbol, logo, file: cached.file, metadataSource: assetSource, assetCode: asset.assetCode, assetName: asset.assetName };
  } catch (error) { failures.push({ logo, error: error.message }); }
}
const sorted = value => Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)));
const identities = Object.fromEntries(rows.map(row => [row.symbol, { name: row.name, market: row.market, type: row.type, baseAsset: row.baseAsset, underlyingSymbol: row.underlyingSymbol, currency: row.currency }]));
await writeFile(new URL('../src/symbol-logo-catalog.js', import.meta.url), `// Public symbol metadata fetched by scripts/sync-all-symbol-logos.mjs. Runtime is offline.\nexport const SYMBOL_LOGOS=${JSON.stringify(sorted(logos), null, 2)};\nexport const SYMBOL_IDENTITIES=${JSON.stringify(sorted(identities), null, 2)};\n`);
const missing = rows.filter(row => !logos[row.symbol] && !['forex', 'futures', 'cn-futures'].includes(row.market));
await writeFile(new URL('sources.json', root), JSON.stringify({ retrievedAt: new Date().toISOString(), metadataSource: 'https://scanner.tradingview.com/global/scan', symbols: sorted(manifestSymbols), assets: [...assets.values()].sort((a,b) => a.logo.localeCompare(b.logo)), failures, missing: missing.map(row => ({ symbol: row.symbol, name: row.name, market: row.market })) }, null, 2));
console.log(JSON.stringify({ catalog: rows.length, mappedSymbols: rows.filter(row => logos[row.symbol]).length, assets: files.size, failures, missing: missing.map(row => row.symbol) }, null, 2));
