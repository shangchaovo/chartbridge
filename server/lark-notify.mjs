import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFeishuWebhook, sendFeishuText } from './feishu.mjs';

function larkLaunch() {
  const script = process.env.LARK_CLI_SCRIPT || (process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js') : '');
  if (script && existsSync(script)) return { command: process.execPath, argsPrefix: [script] };
  return { command: process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli', argsPrefix: [], shell: process.platform === 'win32' };
}

export function runLark(args, { timeoutMs = 25000, spawnImpl = spawn } = {}) {
  const launch = larkLaunch();
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl(launch.command, [...launch.argsPrefix, ...args], {
        windowsHide: true,
        shell: Boolean(launch.shell),
        env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
      });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, stdout, stderr: 'timeout' }); }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += chunk; });
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: error.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export function parseLarkJson(text) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function larkIdentity(run = runLark) {
  const result = await run(['auth', 'status', '--json']);
  const body = parseLarkJson(result.stdout) || parseLarkJson(result.stderr) || {};
  const user = body.identities?.user || {};
  const bot = body.identities?.bot || {};
  return {
    userReady: user.available === true,
    botReady: bot.available === true,
    openId: typeof user.openId === 'string' ? user.openId : '',
    userName: typeof user.userName === 'string' ? user.userName : '',
  };
}

function messageIdOf(body) {
  return body?.data?.message_id || body?.message_id || body?.data?.message?.message_id || '';
}

export async function sendViaLarkCli(text, { run = runLark, idempotencyKey = 'shanhai-alert-test' } = {}) {
  const identity = await larkIdentity(run);
  if (!identity.openId) return { sent: false, reason: 'cli_no_user' };
  const as = identity.userReady ? 'user' : identity.botReady ? 'bot' : '';
  if (!as) return { sent: false, reason: 'cli_unavailable' };
  const result = await run([
    'im', '+messages-send', '--as', as, '--user-id', identity.openId,
    '--text', String(text).slice(0, 2000), '--idempotency-key', String(idempotencyKey).slice(0, 50),
  ]);
  const body = parseLarkJson(result.stdout) || parseLarkJson(result.stderr) || {};
  if (result.code === 10 || body.error?.type === 'confirmation') return { sent: false, reason: 'confirmation_required' };
  const messageId = messageIdOf(body);
  if (result.code === 0 && body.ok !== false && messageId) {
    return { sent: true, channel: as === 'user' ? 'lark-cli-user' : 'lark-cli-bot', messageId, userName: identity.userName };
  }
  return { sent: false, reason: 'cli_rejected' };
}

export async function deliverPriceNotice(text, { run = runLark, readConfig, idempotencyKey, env = process.env } = {}) {
  const cli = await sendViaLarkCli(text, { run, idempotencyKey });
  if (cli.sent) return { ...cli, commit: true, notice: cli.channel };
  // cli_rejected（如平台侧 21001 访问控制）同样回落到 webhook 备用通道；确认门禁保持停止。
  if (cli.reason === 'confirmation_required') return { ...cli, commit: false };
  const target = await resolveFeishuWebhook({ env, readConfig });
  if (!target.configured) return { sent: false, commit: true, notice: cli.reason || (target.invalid ? 'invalid_webhook' : 'missing_webhook'), reason: cli.reason || (target.invalid ? 'invalid_webhook' : 'missing_webhook') };
  const webhook = await sendFeishuText(target, text);
  if (!webhook.sent) return { sent: false, commit: false, reason: webhook.reason };
  return { sent: true, commit: true, notice: 'feishu-webhook', channel: 'feishu-webhook' };
}

export function channelStatus(identity, webhook) {
  if (identity.userReady) return { configured: true, transport: 'lark-cli-user', label: `飞书将用已登录用户${identity.userName ? ` ${identity.userName}` : ''}的身份，在行情到达后立刻发给你自己。`, missing: '' };
  if (identity.botReady) return { configured: true, transport: 'lark-cli-bot', label: '飞书机器人已可用。行情到达后立刻发给本机已记录的用户。', missing: '' };
  if (webhook.configured) return { configured: true, transport: 'feishu-webhook', label: '飞书自定义机器人 webhook 可用。行情到达后立刻发送。', missing: '' };
  return {
    configured: false,
    transport: 'none',
    label: '',
    missing: 'lark-cli 还没有可用身份：机器人缺少 app secret 或 token，用户登录也缺失。价格提醒会先走 lark-cli，失败后再试 data/notify.json 的 feishuWebhook。',
  };
}
