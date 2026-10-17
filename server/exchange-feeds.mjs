// OKX & Kraken public spot feeds: REST candles/tickers and official WebSocket decoders.
// Public endpoints, no keys, no generated prices. Frames that fail validation are dropped, never fabricated.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import WebSocket from 'ws';
import { MarketDataError } from './market-data.mjs';

const TIMEOUT_MS = 12_000;
const OKX_REST = 'https://www.okx.com';
const KRAKEN_REST = 'https://api.kraken.com';
const OKX_BAR = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W' };
const KRAKEN_MINUTES = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 };
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numberOrNull = value => finite(value) ? Number(value) : null;

// 本机直连公共 WebSocket 若被网络重置（实测 ws.okx.com 8443/443 与 ws.kraken.com 均复位），退回环境变量给定的本地
// HTTP 代理 CONNECT 隧道。只更换网络出口，不改变数据来源与口径；回退时通过 onMode 向上层如实披露。
export function proxyFromEnv() {
  const raw = String(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' || !url.hostname || !Number.isInteger(Number(url.port || '0')) || Number(url.port) <= 0) return null;
  return { host: url.hostname, port: Number(url.port) };
}

export function createTunnelAgent(targetHost, targetPort, proxy) {
  return new class extends https.Agent {
    createConnection(options, cb) {
      const req = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: `${targetHost}:${targetPort}`, agent: false });
      req.once('connect', (res, socket) => {
        if (res.statusCode !== 200) { cb(new Error(`本机代理 CONNECT 返回 ${res.statusCode}。`)); return; }
        const tlsSocket = tls.connect({ socket, servername: targetHost }, () => cb(null, tlsSocket));
        tlsSocket.once('error', cb);
      });
      req.once('error', cb);
      req.end();
    }
  }();
}

export function publicWsSocket(url, attempt = 1, { onMode = null } = {}) {
  const attemptNo = Math.max(1, Number(attempt) || 1);
  const connect = (url_, options) => new WebSocket(url_, { handshakeTimeout: 15000, ...options });
  if (attemptNo <= 2) { onMode?.('direct'); return connect(url); }
  const proxy = proxyFromEnv();
  const match = /^wss:\/\/([^:/?#]+)(?::(\d+))?/.exec(url);
  if (!proxy || !match) { onMode?.('direct'); return connect(url); }
  const [, host, portRaw] = match;
  const port = Number(portRaw) || 443;
  onMode?.('proxy-tunnel');
  return connect(url, { agent: createTunnelAgent(host, port, proxy) });
}

export const isOkxSymbol = symbol => /^OKX:[A-Z0-9-]{3,20}$/.test(symbol);
export const isKrakenSymbol = symbol => /^KRAKEN:[A-Z0-9\\/]{3,20}$/.test(symbol);
export const isExchangeSymbol = symbol => isOkxSymbol(symbol) || isKrakenSymbol(symbol);

export function okxInstId(symbol) {
  return isOkxSymbol(symbol) ? symbol.slice(4) : null;
}
export function okxSymbol(instId) {
  return /^([A-Z0-9]{1,10}-[A-Z0-9]{1,10})$/.test(instId) ? `OKX:${instId}` : null;
}
export function krakenPair(symbol) {
  if (!isKrakenSymbol(symbol)) return null;
  const pair = symbol.slice(7).replace('/', '');
  return pair.replace('BTC', 'XBT').replace('DOGE', 'XDG');
}
export function krakenWsSymbol(symbol) {
  // KRAKEN:XBT/USD input behaves as BTC/USD on Kraken WS v2.
  if (!isKrakenSymbol(symbol)) return null;
  return symbol.slice(7).replace(/^XBT/, 'BTC').replace(/^XDG/, 'DOGE');
}

// Kraken WS sends display symbols like 'BTC/USD'; keep them as the user-facing KRAKEN:x/y form.
export function krakenRestoredSymbol(wsSymbol) {
  const upper = String(wsSymbol || '').toUpperCase();
  if (!/^[A-Z0-9]{2,10}\/(USD|USDT|USDC|EUR|JPY|GBP|BTC|ETH|SOL)$/.test(upper)) return null;
  return `KRAKEN:${upper.replace(/^XBT/, 'BTC').replace(/^XDG/, 'DOGE')}`;
}

async function fetchJson(url, provider) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 LocalChart/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new MarketDataError(`${provider} ${timeout ? '行情请求超时' : '行情网络请求失败'}。`,
      timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', timeout ? 504 : 502, { provider, sourceUrl: url });
  }
  if (!response.ok) {
    throw new MarketDataError(`${provider} 行情请求失败（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR', 502,
      { provider, sourceUrl: url, upstreamStatus: response.status });
  }
  return response.json();
}

/** OKX REST candles come newest-first; `after` paginates toward older bars (exclusive by bar timestamp). */
async function fetchOkxCandles({ symbol, interval, limit }) {
  const instId = okxInstId(symbol);
  const bar = OKX_BAR[interval];
  if (!instId || !bar) throw new MarketDataError('OKX 不支持该周期。', 'UNSUPPORTED_INTERVAL', 422, { provider: 'okx' });
  const warnings = ['OKX 现货公共 K 线；最后一根 K 线可能仍在形成。'];
  const rows = [];
  let after = '';
  while (rows.length < limit) {
    const params = new URLSearchParams({ instId, bar, limit: '300' });
    if (after) params.set('after', String(after));
    const sourceUrl = `${OKX_REST}/api/v5/market/candles?${params}`;
    const payload = await fetchJson(sourceUrl, 'OKX');
    if (Number(payload?.code) !== 0) {
      throw new MarketDataError(payload?.msg || 'OKX 未返回有效数据。', 'INVALID_UPSTREAM_RESPONSE', 502,
        { provider: 'okx', sourceUrl, upstreamCode: payload?.code });
    }
    const batch = Array.isArray(payload.data) ? payload.data : [];
    if (!batch.length) break;
    for (const row of batch) {
      rows.push({
        timestamp: Number(row[0]), open: row[1], high: row[2], low: row[3], close: row[4],
        volume: row[5], closeTime: Number(row[0]) + barCloseMs(bar) - 1, closed: row[8] === '1',
      });
    }
    after = batch.at(-1)[0];
    if (batch.length < 300) break;
  }
  if (!rows.length) throw new MarketDataError('OKX 未返回有效 K 线。', 'NO_DATA', 404, { provider: 'okx' });
  const ticker = await fetchOkxTicker({ instId });
  const bands = rows.map(normalizeCloseBand).filter(Boolean);
  const sorted = [...new Map(bands.map(row => [row.timestamp, row])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  if (!sorted.length) throw new MarketDataError('OKX 未返回有效 K 线。', 'NO_DATA', 404, { provider: 'okx' });
  return {
    symbol, interval, candles: sorted, quote: makeQuote(ticker, { symbol, provider: 'okx', providerName: 'OKX', sourceUrl: `${OKX_REST}/api/v5/market/ticker`, volumeKey: 'volCcy24h' }),
    meta: {
      provider: 'okx', providerName: 'OKX', sourceUrl: `${OKX_REST}/api/v5/market/candles`, exchange: 'OKX',
      currency: instId.split('-')[1] || 'USDT', name: symbol, timezone: 'UTC', delayMinutes: 0, feedType: 'snapshot',
      priceBasis: 'spot', fetchedAt: Date.now(), lastCandleTime: sorted.at(-1).timestamp, requestedLimit: limit,
      returnedCount: sorted.length, warnings,
    },
  };
}

function barCloseMs(bar) {
  return { '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1H': 3_600_000, '1D': 86_400_000, '1W': 604_800_000 }[bar] ?? 60_000;
}

function normalizeCloseBand(row) {
  if (!['timestamp', 'close'].every(key => finite(row[key])) || ['open', 'high', 'low'].some(key => !finite(row[key]))) return null;
  const timestamp = Number(row.timestamp);
  const candle = { timestamp, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) };
  if (candle.timestamp <= 0 || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)
    || candle.high < candle.low) return null;
  candle.volume = finite(row.volume) && Number(row.volume) >= 0 ? Number(row.volume) : 0;
  if (finite(row.closeTime) && Number(row.closeTime) >= timestamp) { candle.closeTime = Number(row.closeTime); candle.closed = Boolean(row.closed); }
  return candle;
}

/** Decode an OKX public WebSocket frame. Tickers channel only; anything else (pong/event) is accepted as keepalive or dropped. */
export function decodeOkxFrame(raw, receivedAt = Date.now()) {
  if (typeof raw === 'string' && ['ping', 'pong'].includes(raw.trim())) return { type: 'keepalive', receivedAt };
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (data === 'pong' || data === 'ping') return { type: 'keepalive', receivedAt };
  if (Array.isArray(data?.data) && data?.arg?.channel === 'tickers') {
    const events = [];
    for (const row of data.data) {
      const symbol = okxSymbol(row?.instId);
      if (!symbol || !finite(row.last) || !finite(row.ts)) continue;
      const price = Number(row.last), change = finite(row.open24h) ? price - Number(row.open24h) : null;
      events.push({
        type: 'quote',
        symbol,
        quote: {
          price, change, changePercent: change !== null && Number(row.open24h) > 0 ? change / Number(row.open24h) * 100 : null,
          previousClose: finite(row.open24h) ? Number(row.open24h) : null, timestamp: Number(row.ts),
          open: numberOrNull(row.open24h), high: numberOrNull(row.high24h), low: numberOrNull(row.low24h),
          volume: numberOrNull(row.volCcy24h), changePeriod: 'rolling-24h',
        },
        meta: {
          provider: 'okx-ws', providerName: 'OKX 官方 WebSocket', sourceUrl: 'wss://ws.okx.com:8443/ws/v5/public',
          feedType: 'push', delayMinutes: 0, sourceTime: Number(row.ts), receivedAt, ageMs: Math.max(0, receivedAt - Number(row.ts)),
        },
      });
    }
    if (!events.length) return null;
    return { type: 'batch', events, receivedAt };
  }
  return null;
}

async function fetchOkxTicker({ instId }) {
  const sourceUrl = `${OKX_REST}/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const payload = await fetchJson(sourceUrl, 'OKX');
  if (Number(payload?.code) !== 0 || !payload?.data?.[0]) {
    throw new MarketDataError(payload?.msg || 'OKX 未返回有效报价。', 'NO_DATA', 404, { provider: 'okx', sourceUrl, upstreamCode: payload?.code });
  }
  return payload.data[0];
}

function makeQuote(row, { symbol, provider, providerName, sourceUrl, volumeKey }) {
  if (!row || !finite(row.last)) return null;
  const price = Number(row.last);
  const change = finite(row.open24h) ? price - Number(row.open24h) : null;
  return {
    price, change,
    changePercent: change !== null && finite(row.open24h) && Number(row.open24h) > 0 ? change / Number(row.open24h) * 100 : null,
    previousClose: finite(row.open24h) ? Number(row.open24h) : null,
    timestamp: finite(row.ts) ? Number(row.ts) : (finite(row.t) ? Number(row.t) * 1000 : null),
    open: numberOrNull(row.open24h), high: numberOrNull(row.high24h), low: numberOrNull(row.low24h),
    volume: numberOrNull(row[volumeKey]), changePeriod: 'rolling-24h',
  };
}

export { fetchOkxCandles, fetchKrakenCandles };
async function fetchKrakenCandles({ symbol, interval, limit }) {
  const pair = krakenPair(symbol);
  const minutes = KRAKEN_MINUTES[interval];
  if (!pair || !minutes) throw new MarketDataError('Kraken 不支持该周期。', 'UNSUPPORTED_INTERVAL', 422, { provider: 'kraken' });
  const sourceUrl = `${KRAKEN_REST}/0/public/OHLC?${new URLSearchParams({ pair, interval: String(minutes) })}`;
  const payload = await fetchJson(sourceUrl, 'Kraken');
  if (payload?.error?.length) {
    throw new MarketDataError(`Kraken 拒绝了请求：${payload.error.join('; ')}`, 'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'kraken', sourceUrl, upstreamError: payload.error });
  }
  const result = payload?.result || {};
  const series = Object.entries(result).find(([key, value]) => key !== 'last' && Array.isArray(value))?.[1];
  if (!Array.isArray(series) || !series.length) {
    throw new MarketDataError('Kraken 未返回有效 K 线。', 'NO_DATA', 404, { provider: 'kraken', sourceUrl });
  }
  const rows = series.map(row => ({
    timestamp: Number(row[0]) * 1000, open: row[1], high: row[2], low: row[3], close: row[4],
    volume: row[6], closeTime: Number(row[0]) * 1000 + minutes * 60_000 - 1, closed: true,
  }));
  const candles = rows.map(normalizeCloseBand).filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
  if (!candles.length) throw new MarketDataError('Kraken 未返回有效 K 线。', 'NO_DATA', 404, { provider: 'kraken', sourceUrl });
  const ticker = await fetchKrakenTicker({ pair });
  const last = candles.at(-1);
  return {
    symbol, interval, candles,
    quote: ticker || { price: last.close, timestamp: last.timestamp, change: null, changePercent: null, volume: last.volume },
    meta: {
      provider: 'kraken', providerName: 'Kraken', sourceUrl, exchange: 'KRAKEN',
      currency: (krakenWsSymbol(symbol) || '').split('/').pop() || 'USD', name: symbol, timezone: 'UTC',
      delayMinutes: 0, feedType: 'snapshot', priceBasis: 'spot', fetchedAt: Date.now(),
      lastCandleTime: last.timestamp, requestedLimit: limit, returnedCount: candles.length,
      warnings: ['Kraken 现货公共 K 线；官方日线/分钟线均为已收盘序列。'],
    },
  };
}

async function fetchKrakenTicker({ pair }) {
  const sourceUrl = `${KRAKEN_REST}/0/public/Ticker?pair=${encodeURIComponent(pair)}`;
  const payload = await fetchJson(sourceUrl, 'Kraken');
  if (payload?.error?.length) {
    throw new MarketDataError(`Kraken 报价请求被拒绝：${payload.error.join('; ')}`, 'INVALID_UPSTREAM_RESPONSE', 502, { provider: 'kraken', sourceUrl, upstreamError: payload.error });
  }
  const entry = Object.values(payload?.result || {}).find(row => row && typeof row === 'object');
  if (!entry || !finite(entry.c?.[0])) return null;
  const price = Number(entry.c[0]);
  const change = finite(entry.o) ? price - Number(entry.o) : null;
  return {
    price, change,
    changePercent: change !== null && Number(entry.o) > 0 ? change / Number(entry.o) * 100 : null,
    previousClose: finite(entry.o) ? Number(entry.o) : null,
    timestamp: Date.now(), open: numberOrNull(entry.o), high: numberOrNull(entry.h?.[1]), low: numberOrNull(entry.l?.[1]),
    volume: numberOrNull(entry.v?.[1]), changePeriod: 'rolling-24h',
  };
}

/** Decode a Kraken v2 WebSocket frame (ticker channel; heartbeat arrives as method pings). */
export function decodeKrakenFrame(raw, receivedAt = Date.now()) {
  let data;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (data?.method === 'heartbeat' || data?.type === 'pong') return { type: 'keepalive', receivedAt };
  if (data?.channel === 'ticker' && Array.isArray(data?.data)) {
    const events = [];
    for (const row of data.data) {
      const symbol = krakenRestoredSymbol(row?.symbol);
      if (!symbol || !finite(row.last)) continue;
      const price = Number(row.last);
      const change = finite(row.change) ? Number(row.change) : null;
      events.push({
        type: 'quote',
        symbol,
        quote: {
          price, change, changePercent: finite(row.changePct) ? Number(row.changePct) : null,
          previousClose: finite(row.open) && finite(row.change) ? price - Number(row.change) : null,
          timestamp: receivedAt, open: numberOrNull(row.open), high: numberOrNull(row.high), low: numberOrNull(row.low),
          volume: numberOrNull(row.volume), changePeriod: 'rolling-24h',
        },
        meta: {
          provider: 'kraken-ws', providerName: 'Kraken 官方 WebSocket', sourceUrl: 'wss://ws.kraken.com/v2',
          feedType: 'push', delayMinutes: 0, sourceTime: receivedAt,
          sourceTimeNote: 'Kraken v2 ticker 不携带交易所时间戳；sourceTime 以本机接收时间标记。', receivedAt, ageMs: 0,
        },
      });
    }
    if (!events.length) return null;
    return { type: 'batch', events, receivedAt };
  }
  return null;
}


