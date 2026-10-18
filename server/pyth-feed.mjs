import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MarketDataError } from './market-data.mjs';

const BASE = 'https://pyth.dourolabs.app/v1';
const CHANNEL = 'fixed_rate@200ms';
const resolutions = { '1m': ['1', 60], '5m': ['5', 300], '15m': ['15', 900], '30m': ['30', 1800], '1h': ['60', 3600], '4h': ['240', 14400], '1d': ['D', 86400], '1w': ['W', 604800] };
const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (message, code, status = 502) => new MarketDataError(message, code, status, { provider: 'pyth' });

export function createPythFeed({ path = resolve(process.env.TERMINAL_DATA_DIR || resolve(root, 'data'), 'pyth.json'), env = process.env, fetchImpl = (...args) => fetch(...args), clock = Date.now } = {}) {
  async function config() {
    let saved = {};
    try { saved = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw fail('PYTH 本机配置无法读取。', 'FEED_CONFIG_ERROR'); }
    const environmentKey = env.PYTH_PRO_API_KEY || env.PYTH_API_KEY || env.PYTH_ACCESS_TOKEN;
    const apiKey = environmentKey || saved.apiKey || '';
    return { apiKey, verifiedAt: apiKey === saved.apiKey ? saved.verifiedAt || null : null, source: apiKey ? (environmentKey ? 'environment' : 'local') : null };
  }
  async function status() {
    const { apiKey, verifiedAt, source } = await config();
    return { configured: Boolean(apiKey), verifiedAt, source, channel: CHANNEL, terminalUrl: 'https://pythdata.app/', symbol: 'PYTH:XAUUSD' };
  }
  async function request(params, apiKey) {
    const url = `${BASE}/${CHANNEL}/history?${new URLSearchParams(params)}`;
    let response;
    try { response = await fetchImpl(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw fail('无法连接 PYTH 历史接口，请检查网络后重试。', 'FEED_UNAVAILABLE'); }
    if (response.status === 401) throw fail('PYTH Key 无效或已过期，请重新领取并填写。', 'FEED_AUTH_REQUIRED', 422);
    if (response.status === 403) throw fail('此 Key 尚未获准读取黄金历史行情，请检查试用权限。', 'FEED_NOT_ENTITLED', 422);
    if (response.status === 429) throw fail('PYTH 请求次数已达限制，请稍后重试。', 'FEED_RATE_LIMIT', 429);
    if (!response.ok) throw fail(`PYTH 历史接口暂不可用（HTTP ${response.status}）。`, 'UPSTREAM_HTTP_ERROR');
    try { return { data: await response.json(), sourceUrl: url }; }
    catch { throw fail('PYTH 返回的数据格式无效。', 'INVALID_UPSTREAM_RESPONSE'); }
  }
  async function candles({ symbol = 'PYTH:XAUUSD', interval = '1d', limit = 500, before, apiKey: suppliedKey } = {}) {
    if (symbol !== 'PYTH:XAUUSD') throw fail('该 PYTH 品种尚未配置数据映射。', 'UNSUPPORTED_SYMBOL', 422);
    if (!resolutions[interval] || !Number.isInteger(limit) || limit < 2 || limit > 5000 || (before != null && (!Number.isSafeInteger(before) || before <= 0))) throw fail('PYTH 周期、条数或历史游标无效。', 'INVALID_PARAMETERS', 400);
    const apiKey = suppliedKey || (await config()).apiKey;
    if (!apiKey) throw fail('PYTH 黄金历史行情需要 API Key，请在「行情与数据」中填写试用 Key。', 'FEED_AUTH_REQUIRED', 422);
    const [resolution, span] = resolutions[interval];
    const byTime = new Map();
    let end = Math.floor(((before ?? clock() + 1) - 1) / 1000), empty = 0, exhausted = false, missingVolume = false, sourceUrl;
    for (let page = 0; page < 32 && byTime.size < limit; page += 1) {
      // Calendar windows include closed-market days; a short response is not an end-of-history signal.
      const width = Math.max((span < 86400 ? 3 : 14) * 86400, Math.min(500, limit) * span * 2) * Math.min(8, 2 ** empty);
      const from = Math.max(0, end - width);
      const result = await request({ symbol: 'Metal.XAU/USD', from: String(from), to: String(end), resolution }, apiKey);
      sourceUrl = result.sourceUrl;
      const data = result.data;
      if (!data || !['ok', 'no_data'].includes(data.s)) throw fail('PYTH 未返回有效历史 K 线，请检查权限及所选区间。', 'INVALID_UPSTREAM_RESPONSE');
      if (data.s === 'no_data' || (Array.isArray(data.t) && !data.t.length)) {
        empty += 1;
        if (from === 0) { exhausted = true; break; }
        if (empty >= 6) break;
        const nextTime = Number(data.nextTime);
        end = data.nextTime != null && Number.isFinite(nextTime) && nextTime > 0 && nextTime < from ? Math.floor(nextTime) : from - 1;
        continue;
      }
      if (!Array.isArray(data.t) || !['o', 'h', 'l', 'c'].every(key => Array.isArray(data[key]) && data[key].length === data.t.length) || (data.v != null && (!Array.isArray(data.v) || data.v.length !== data.t.length))) throw fail('PYTH K 线字段长度不一致。', 'INVALID_UPSTREAM_RESPONSE');
      missingVolume ||= !data.v;
      let oldest = Infinity;
      for (let i = 0; i < data.t.length; i += 1) {
        if (['t','o','h','l','c',...(data.v ? ['v'] : [])].some(key => !['number','string'].includes(typeof data[key][i]) || String(data[key][i]).trim() === '')) throw fail('PYTH K 线包含空价格或时间。', 'INVALID_UPSTREAM_RESPONSE');
        const row = { timestamp: Number(data.t[i]) * 1000, open: Number(data.o[i]), high: Number(data.h[i]), low: Number(data.l[i]), close: Number(data.c[i]), volume: data.v ? Number(data.v[i]) : 0 };
        if (!Object.values(row).every(Number.isFinite) || !Number.isSafeInteger(row.timestamp) || row.timestamp < 0 || Math.min(row.open,row.high,row.low,row.close) <= 0 || row.volume < 0 || row.high < Math.max(row.open, row.close, row.low) || row.low > Math.min(row.open, row.close)) throw fail('PYTH K 线包含无效价格或时间。', 'INVALID_UPSTREAM_RESPONSE');
        const seconds = row.timestamp / 1000;
        if (seconds < from || seconds > end || (before != null && row.timestamp >= before)) continue;
        oldest = Math.min(oldest, seconds); byTime.set(row.timestamp, row);
      }
      if (!Number.isFinite(oldest)) throw fail('PYTH 没有返回所请求区间内的 K 线。', 'INVALID_UPSTREAM_RESPONSE');
      end = oldest - 1; empty = 0;
      if (from === 0 && oldest === 0) { exhausted = true; break; }
    }
    const rows = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
    if (!rows.length) throw fail('当前试用权限或所选区间没有 PYTH 黄金历史数据。', 'FEED_HISTORY_UNAVAILABLE', 422);
    const last = rows.at(-1);
    return { symbol, interval, candles: rows, quote: { price: last.close, timestamp: last.timestamp, change: null, changePercent: null, volume: null },
      meta: { provider: 'pyth', providerName: 'Pyth Pro 历史行情', exchange: 'PYTH', name: '黄金 XAU/USD', currency: 'USD', timezone: 'UTC', channel: CHANNEL,
        sourceUrl, feedType: 'snapshot', priceBasis: 'oracle', fetchedAt: clock(), returnedCount: rows.length, exhausted,
        warnings: ['报价为 PYTH 历史 K 线收盘价，实时推送未接入；历史范围以 Key 的实际授权为准。', ...(missingVolume ? ['PYTH 未提供成交量；图表成交量置零，不代表市场无成交。'] : [])] } };
  }
  async function save(apiKey) {
    if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 8192 || /\s/.test(apiKey.trim())) throw fail('请输入完整的 PYTH API Key。', 'INVALID_FEED_KEY', 400);
    apiKey = apiKey.trim();
    const current = await config();
    if (current.source === 'environment' && current.apiKey !== apiKey) throw fail('PYTH Key 由环境变量配置，请先更新对应的环境变量。', 'FEED_CONFIG_ENV', 422);
    // Verify the actual requested metal feed before replacing any working configuration.
    const sample = await candles({ limit: 2, apiKey });
    const saved = { apiKey, verifiedAt: new Date(clock()).toISOString() };
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
    return { ...(await status()), sample: { count: sample.candles.length, newest: sample.candles.at(-1).timestamp } };
  }
  return { status, save, candles };
}

export const pythFeed = createPythFeed();
