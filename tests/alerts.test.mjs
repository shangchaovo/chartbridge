import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts } from '../src/alerts.js';
import { resolveFeishuWebhook, sendFeishuText } from '../server/feishu.mjs';
import { sendViaLarkCli } from '../server/lark-notify.mjs';
import { alertMessage, createPriceAlerts, mergeFiredAlerts } from '../server/price-alerts.mjs';
import { QUOTE_POLL_MS } from '../server/market-hub.mjs';

test('a quote triggers only the matching unfired rule', () => {
  const alerts = [
    { id: 'high', symbol: 'BTCUSDT', direction: 'above', price: 100, firedAt: null },
    { id: 'low', symbol: 'BTCUSDT', direction: 'below', price: 90, firedAt: null },
    { id: 'done', symbol: 'BTCUSDT', direction: 'above', price: 1, firedAt: 1 },
    { id: 'other', symbol: 'ETHUSDT', direction: 'above', price: 1, firedAt: null },
  ];
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 101 }).map(alert => alert.id), ['high']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'ETHUSDT', price: 2 }).map(alert => alert.id), ['other']);
});

test('saving the workspace cannot clear a trigger the server already recorded', () => {
  const previous = { alerts: [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 1, firedAt: 50, triggerPrice: 2, notice: 'missing_webhook' }] };
  const next = { alerts: [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 1, firedAt: null }] };
  assert.equal(mergeFiredAlerts(previous, next).alerts[0].firedAt, 50);
  assert.equal(mergeFiredAlerts(previous, next).alerts[0].notice, 'missing_webhook');
});

test('quote arrival commits one notice and does not wait for a minute timer', async () => {
  let stored = [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 10, firedAt: null }];
  const sent = [];
  const published = [];
  const service = createPriceAlerts({
    readState: async () => ({ alerts: stored }),
    updateAlerts: async fired => { stored = stored.map(alert => fired.find(item => item.id === alert.id) || alert); },
    deliver: async (_alert, price) => { sent.push(price); return { commit: true, notice: 'feishu' }; },
    publish: event => published.push(event),
    clock: () => 1000,
  });
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 11 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 12 } }]);
  assert.deepEqual(sent, [11]);
  assert.equal(stored[0].firedAt, 1000);
  assert.equal(published[0].type, 'alert');
  assert.match(alertMessage(stored[0], 11), /BTCUSDT/);
});

test('feishu webhook is refused unless it is a bot hook, and a missing hook is not reported as sent', async () => {
  assert.equal((await resolveFeishuWebhook({ env: {}, readConfig: async () => ({}) })).configured, false);
  assert.equal((await resolveFeishuWebhook({ env: { FEISHU_WEBHOOK_URL: 'https://example.com/hook' }, readConfig: async () => ({}) })).invalid, true);
  const target = await resolveFeishuWebhook({ env: {}, readConfig: async () => ({ feishuWebhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc-def-123' }) });
  assert.equal(target.configured, true);
  let called = 0;
  const missing = await sendFeishuText({ configured: false }, '【测试】', async () => { called += 1; });
  assert.equal(missing.sent, false);
  assert.equal(missing.reason, 'missing_webhook');
  assert.equal(called, 0);
  const sent = await sendFeishuText(target, '【测试】山海', async () => ({ ok: true, json: async () => ({ code: 0, StatusCode: 0 }) }));
  assert.equal(sent.sent, true);
});

test('lark-cli delivery counts as sent only when the CLI returns a message id', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'auth') return { code: 0, stdout: JSON.stringify({ identities: { user: { available: true, openId: 'ou_test', userName: 'Tester' }, bot: { available: false } } }), stderr: '' };
    return { code: 0, stdout: JSON.stringify({ ok: true, data: { message_id: 'om_test' } }), stderr: '' };
  };
  const sent = await sendViaLarkCli('【测试】山海', { run, idempotencyKey: 'k' });
  assert.equal(sent.sent, true);
  assert.equal(sent.messageId, 'om_test');
  assert.equal(sent.channel, 'lark-cli-user');
  assert.deepEqual(calls[1].slice(0, 4), ['im', '+messages-send', '--as', 'user']);
  const missingId = await sendViaLarkCli('【测试】山海', { run: async args => args[0] === 'auth' ? run(args) : { code: 0, stdout: JSON.stringify({ ok: true, data: {} }), stderr: '' } });
  assert.equal(missingId.sent, false);
  const unavailable = await sendViaLarkCli('【测试】山海', { run: async () => ({ code: 0, stdout: JSON.stringify({ identities: { user: { available: false, openId: 'ou_test' }, bot: { available: false } } }), stderr: '' }) });
  assert.equal(unavailable.sent, false);
  assert.equal(unavailable.reason, 'cli_unavailable');
});

test('public quotes are polled in a few seconds rather than once a minute', () => {
  assert.equal(QUOTE_POLL_MS, 3000);
  assert.ok(QUOTE_POLL_MS <= 5000);
});
