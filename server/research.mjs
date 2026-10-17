import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';

const period = z.number().int().min(1).max(500);
const indicator = z.discriminatedUnion('type', [
  ...['SMA', 'EMA', 'RSI', 'ATR'].map(type => z.object({ type: z.literal(type), period: period.default(type === 'SMA' ? 20 : type === 'EMA' ? 12 : 14) }).strict()),
  z.object({ type: z.literal('MACD'), fast: period.default(12), slow: period.default(26), signal: period.default(9) }).strict(),
  z.object({ type: z.literal('BB'), period: period.default(20), multiplier: z.number().min(0.01).max(20).default(2) }).strict(),
]).refine(value => value.type !== 'MACD' || value.fast < value.slow, { message: 'MACD 快线周期必须小于慢线周期。' });

const common = {
  symbol: z.string().regex(/^(?:TQ:[A-Za-z0-9.@^=:_/-]{1,47}|[A-Za-z0-9.^=:_-]{1,40})$/),
  interval: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']).default('1d'),
  limit: z.number().int().min(2).max(1000).default(500),
  refresh: z.boolean().default(false),
  tail: z.number().int().min(1).max(1000).default(5),
};
export const indicatorResearchInput = z.object({ ...common, closedOnly: z.boolean().default(true),
  indicators: z.array(indicator).min(1).max(8).default([{ type: 'SMA', period: 20 }, { type: 'EMA', period: 12 }, { type: 'RSI', period: 14 }]),
}).strict();
export const backtestResearchInput = z.object({ ...common,
  options: z.object({
    strategy: z.enum(['ema-cross', 'rsi', 'buy-hold']).default('ema-cross'),
    fast: period.default(12), slow: period.default(26), rsiPeriod: period.default(14),
    oversold: z.number().min(0).max(100).default(30), overbought: z.number().min(0).max(100).default(70),
    initialCapital: z.number().positive().max(1e12).default(100000),
    feeBps: z.number().min(0).lt(10000).default(10), slippageBps: z.number().min(0).lt(10000).default(5),
  }).strict().refine(o => o.fast < o.slow && o.oversold < o.overbought, { message: '快线需小于慢线；超卖值需小于超买值。' }).default({}),
}).strict();

const fail = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function executeResearch(job, { timeoutMs = 10000, workerURL = new URL('./research-worker.mjs', import.meta.url) } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerURL, { workerData: job, env: {}, stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
    // Engine diagnostics are not part of the protocol output.
    worker.stdout.resume(); worker.stderr.resume();
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      await worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(fail('RESEARCH_TIMEOUT', '本次计算超时，工作线程已停止。', 504)), timeoutMs);
    worker.once('message', value => {
      if (value.error) return finish(fail(value.error.code, value.error.message));
      if (!value.result || Buffer.byteLength(JSON.stringify(value.result)) > 2 * 1024 * 1024) return finish(fail('RESEARCH_OUTPUT_LIMIT', '计算结果超出返回限制。'));
      finish(null, value.result);
    });
    worker.once('error', () => finish(fail('RESEARCH_WORKER_FAILED', '计算工作线程失败或超出内存限制。', 502)));
    worker.once('exit', () => { if (!settled) finish(fail('RESEARCH_WORKER_EXIT', '计算工作线程未返回结果。', 502)); });
  });
}

export class ResearchService {
  constructor({ candles, execute = executeResearch, maxConcurrent = 2 }) {
    this.candles = candles; this.execute = execute; this.maxConcurrent = maxConcurrent; this.active = 0;
  }
  async run(kind, input) {
    const schema = kind === 'indicators' ? indicatorResearchInput : kind === 'backtest' ? backtestResearchInput : null;
    if (!schema) throw fail('INVALID_RESEARCH_KIND', '不支持的研究任务。', 400);
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw fail('INVALID_RESEARCH_INPUT', `研究参数无效：${parsed.error.issues.map(i => `${i.path.join('.') || 'input'} ${i.message}`).join('; ').slice(0, 1200)}`, 400);
    const options = parsed.data;
    if (!options.symbol.startsWith('TQ:')) options.symbol = options.symbol.toUpperCase();
    if (this.active >= this.maxConcurrent) throw fail('RESEARCH_BUSY', '主机正在计算其他研究任务，请稍后重试。', 429);
    this.active++;
    try {
      const payload = await this.candles(new URLSearchParams({ symbol: options.symbol, interval: options.interval, limit: String(options.limit), refresh: options.refresh ? '1' : '0' }));
      const rows = payload.candles;
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw fail('INVALID_RESEARCH_DATA', '数据源未返回可计算的历史序列。', 502);
      const closedOnly = kind === 'backtest' || options.closedOnly;
      const selected = rows.filter((bar, index) => !closedOnly || bar.closed === true || (bar.closed === undefined && index < rows.length - 1));
      if (selected.length < 2) throw fail('INSUFFICIENT_RESEARCH_DATA', '可用历史不足两根；未确认的末根 K 线已排除。');
      const confirmed = selected.filter(b => b.closed === true).length;
      const assumed = closedOnly ? selected.filter(b => b.closed === undefined).length : 0;
      const dataHash = hash(selected.map(b => [b.timestamp, b.open, b.high, b.low, b.close, b.volume, b.closeTime ?? null, b.closed ?? null]));
      const result = await this.execute({ kind, input: options, candles: selected });
      const warnings = [...(payload.meta?.warnings || []), ...(result.warnings || [])];
      if (assumed) warnings.push('源未提供全部收盘标记；按历史顺序推定前序 K 线已收盘，并保守排除未确认末根，尚未使用完整交易日历验证。');
      if (!closedOnly) warnings.push('本次允许未收盘或收盘状态未知的数据；末值可能随行情变化。');
      if (payload.meta?.cache === 'stale') warnings.push('本次基于断网历史缓存计算，结果不代表当前行情。');
      if (result.series?.some(s => s.latest?.value === null)) warnings.push('部分指标尚未完成预热，末值为 null；需要更多历史 K 线。');
      return { ok: true, kind, id: hash({ kind, options, dataHash, engine: result.engine }).slice(0, 24), computedAt: new Date().toISOString(),
        data: { symbol: options.symbol, interval: options.interval, requestedBars: options.limit, receivedBars: rows.length, usedBars: selected.length,
          excludedBars: rows.length - selected.length, closedOnly, confirmedClosedBars: confirmed, assumedClosedBars: assumed,
          unconfirmedBars: selected.length - confirmed - assumed, from: selected[0].timestamp, to: selected.at(-1).timestamp,
          lastClose: selected.at(-1).close, sha256: dataHash, quoteTime: payload.quote?.timestamp ?? null, source: payload.meta || {} },
        ...result, warnings: [...new Set(warnings)] };
    } finally { this.active--; }
  }
}
