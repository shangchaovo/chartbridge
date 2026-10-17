import { createHmac } from 'node:crypto';

const HOOK = /^https:\/\/open\.(?:feishu\.cn|larksuite\.com)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,}$/;

export async function resolveFeishuWebhook({ env = process.env, readConfig } = {}) {
  const candidates = [env.FEISHU_WEBHOOK_URL, env.LARK_WEBHOOK_URL];
  let signSecret = env.FEISHU_WEBHOOK_SIGN_SECRET || '';
  if (readConfig) {
    try {
      const file = await readConfig();
      candidates.push(file?.feishuWebhook);
      if (typeof file?.feishuWebhookSignSecret === 'string') signSecret = file.feishuWebhookSignSecret.trim() || signSecret;
    } catch {
      return { configured: false, invalid: true };
    }
  }
  for (const candidate of candidates) {
    const url = String(candidate || '').trim();
    if (!url) continue;
    if (!HOOK.test(url)) return { configured: false, invalid: true };
    return { configured: true, url, ...(signSecret ? { signSecret } : {}) };
  }
  return { configured: false, invalid: false };
}

export function feishuText(text) {
  return { msg_type: 'text', content: { text: String(text).slice(0, 2000) } };
}

// 飞书自定义机器人「签名校验」：sign = base64(HMAC_SHA256(key=`${timestamp}\n${secret}`))，密钥在 data/notify.json 的 feishuWebhookSignSecret。
export function feishuSignature(secret, timestamp = Math.floor(Date.now() / 1000)) {
  return { timestamp: String(timestamp), sign: createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64') };
}

export async function sendFeishuText(target, text, fetchImpl = fetch) {
  if (!target?.configured || !target.url) {
    return { sent: false, reason: target?.invalid ? 'invalid_webhook' : 'missing_webhook' };
  }
  const body = feishuText(text);
  if (target.signSecret) Object.assign(body, feishuSignature(target.signSecret));
  let response;
  try {
    response = await fetchImpl(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { sent: false, reason: 'upstream_unreachable' };
  }
  const payload = await response.json().catch(() => ({}));
  const code = Number(payload?.code ?? payload?.StatusCode ?? 0);
  if (!response.ok || code !== 0) return { sent: false, reason: 'upstream_rejected', status: response.status };
  return { sent: true };
}
