const MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'deepseek-chat'];

export function publicAgentStatus(config) {
  const missing = [];
  if (!config.apiKey) missing.push('API key（data/agent.json 的 apiKey，或环境变量 OPENAI_API_KEY）');
  return {
    configured: missing.length === 0,
    missing,
    baseUrl: config.baseUrl,
    model: config.model,
    models: MODELS.includes(config.model) ? MODELS : [config.model, ...MODELS],
  };
}

export function mergeAgentConfig(saved, incoming = {}, env = process.env) {
  const file = saved && typeof saved === 'object' ? saved : {};
  const apiKey = String(incoming.apiKey || env.OPENAI_API_KEY || file.apiKey || '').trim();
  const baseUrl = String(incoming.baseUrl || env.OPENAI_BASE_URL || file.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
  const model = String(incoming.model || env.OPENAI_MODEL || file.model || 'gpt-4o-mini').trim();
  return { apiKey, baseUrl, model };
}

export function chatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址只支持 http 或 https。');
  const path = url.pathname.replace(/\/$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  return url;
}

export function candleBrief(candles, limit = 12) {
  return (Array.isArray(candles) ? candles : []).slice(-limit).map(bar => ({
    t: bar.timestamp, o: bar.open, h: bar.high, l: bar.low, c: bar.close,
  })).filter(bar => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

export function parseAgentAnnotations(raw, lastClose) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Agent 没有返回可解析的标注。');
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); }
  catch { throw new Error('Agent 返回的不是 JSON。'); }
  const list = Array.isArray(data.annotations) ? data.annotations : [];
  const annotations = [];
  for (const item of list) {
    if (!item || !['hline', 'text', 'range'].includes(item.kind)) continue;
    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (Number.isFinite(lastClose) && lastClose > 0 && (price < lastClose * 0.2 || price > lastClose * 5)) continue;
    const price2 = Number(item.price2);
    annotations.push({
      kind: item.kind,
      price,
      text: String(item.text || '').replace(/[\u0000-\u001f]/g, '').slice(0, 80),
      ...(Number.isFinite(price2) && price2 > 0 ? { price2 } : {}),
    });
    if (annotations.length >= 4) break;
  }
  if (!annotations.length) throw new Error('Agent 没有返回落在近期价格附近的标注。');
  return annotations;
}

function safeError(text) {
  return String(text || '模型接口没有成功。').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').slice(0, 240);
}

export async function requestAnnotations({ config, symbol, interval, candles, fetchImpl = fetch }) {
  if (!config.apiKey) {
    const error = new Error('缺少 API key。请写入 data/agent.json 或环境变量 OPENAI_API_KEY。');
    error.status = 409;
    throw error;
  }
  const brief = candleBrief(candles);
  if (brief.length < 2) throw Object.assign(new Error('当前图表没有足够的真实 K 线。'), { status: 422 });
  const last = brief.at(-1);
  const url = chatCompletionsUrl(config.baseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: '你是图表标注助手。只返回 JSON，不要解释。格式：{"annotations":[{"kind":"hline"|"text"|"range","price":数字,"price2":数字,"text":"简短中文"}]}。price 必须来自给定 K 线的高低点附近。最多 3 条。' },
        { role: 'user', content: JSON.stringify({ symbol, interval, lastClose: last.c, bars: brief }) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(safeError(payload?.error?.message || `模型接口返回 ${response.status}`)), { status: 502 });
  const content = payload?.choices?.[0]?.message?.content;
  return { annotations: parseAgentAnnotations(content, last.c), model: config.model, symbol, interval, bars: brief.length };
}
