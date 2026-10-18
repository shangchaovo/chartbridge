import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, normalizePriceAlert, alertStatus } from '../src/alerts.js';
import { resolveFeishuWebhook, sendFeishuText } from '../server/feishu.mjs';
import { EventEmitter } from 'node:events';
import { sendViaLarkCli, runLark } from '../server/lark-notify.mjs';
import { alertMessage, createPriceAlerts, mergeFiredAlerts } from '../server/price-alerts.mjs';
import { QUOTE_POLL_MS } from '../server/market-hub.mjs';

test('price reaches the level from either side, and staying on it does not fire again', () => {
  const alerts = [
    { id: 'high', symbol: 'BTCUSDT', direction: 'above', price: 100, firedAt: null },
    { id: 'low', symbol: 'BTCUSDT', direction: 'below', price: 90, firedAt: null },
    { id: 'done', symbol: 'BTCUSDT', direction: 'crossingUp', price: 1, firedAt: 1 },
    { id: 'other', symbol: 'ETHUSDT', direction: 'crossingDown', price: 1, firedAt: null },
  ];
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 100 }, 99).map(alert => alert.id), ['high']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 101 }, 99).map(alert => alert.id), ['high']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 89 }, 101).map(alert => alert.id), ['high', 'low']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 101 }, 102).map(alert => alert.id), []);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 90 }, 91).map(alert => alert.id), ['low']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 91 }, 89).map(alert => alert.id), ['low']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 89 }, 89.5).map(alert => alert.id), []);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 100 }, 100).map(alert => alert.id), []);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 101 }, 100).map(alert => alert.id), []);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'ETHUSDT', price: 2 }, 0.5).map(alert => alert.id), ['other']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'ETHUSDT', price: 0.5 }, 2).map(alert => alert.id), ['other']);
  assert.deepEqual(evaluateAlerts(alerts, { symbol: 'BTCUSDT', price: 101 }).map(alert => alert.id), []);
  for (const direction of ['above', 'below', 'crossing', 'crossingUp', 'crossingDown', null]) {
    assert.equal(normalizePriceAlert({ id: 'a', direction, price: 1 }).direction, 'reach');
  }
  const paused = { id: 'paused', symbol: 'BTCUSDT', direction: 'above', price: 100, firedAt: null, paused: true };
  assert.deepEqual(evaluateAlerts([paused], { symbol: 'BTCUSDT', price: 101 }, 99), []);
  assert.equal(alertStatus(paused), 'paused');
  assert.equal(alertStatus({ firedAt: 1 }), 'fired');
  assert.equal(alertStatus({}), 'active');
});

test('saving the workspace cannot clear a trigger the server already recorded', () => {
  const previous = { alerts: [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 1, firedAt: 50, triggerPrice: 2, notice: 'missing_webhook' }] };
  const next = { alerts: [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 1, firedAt: null }] };
  assert.equal(mergeFiredAlerts(previous, next).alerts[0].firedAt, 50);
  assert.equal(mergeFiredAlerts(previous, next).alerts[0].notice, 'missing_webhook');
});

test('quote arrival commits one notice when price reaches the level from below or above', async () => {
  let stored = [{ id: 'a', symbol: 'BTCUSDT', direction: 'above', price: 10, firedAt: null }];
  const sent = [];
  const published = [];
  const service = createPriceAlerts({
    readState: async () => ({ alerts: stored }),
    updateAlerts: async fired => { stored = stored.map(alert => fired.find(item => item.id === alert.id) || alert); },
    deliver: async (_alert, price) => { sent.push(price); return { commit: true, notice: 'local' }; },
    publish: event => published.push(event),
    clock: () => 1000,
  });
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 9 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 9 } }]);
  assert.deepEqual(sent, []);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 10 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 10 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 12 } }]);
  assert.deepEqual(sent, [10]);
  assert.equal(stored[0].firedAt, 1000);
  assert.equal(published[0].type, 'alert');
  assert.match(alertMessage(stored[0], 10), /达到/);
  assert.doesNotMatch(alertMessage(stored[0], 10), /上穿|下穿/);

  stored = [{ id: 'b', symbol: 'BTCUSDT', direction: 'crossingDown', price: 10, firedAt: null }];
  const down = [];
  const downService = createPriceAlerts({
    readState: async () => ({ alerts: stored }),
    updateAlerts: async fired => { stored = stored.map(alert => fired.find(item => item.id === alert.id) || alert); },
    deliver: async (_alert, price) => { down.push(price); return { commit: true, notice: 'local' }; },
    clock: () => 2000,
  });
  await downService.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 12 } }]);
  await downService.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 11 } }]);
  assert.deepEqual(down, []);
  await downService.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 10 } }]);
  await downService.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 10 } }]);
  assert.deepEqual(down, [10]);
});

test('an alert already sitting on its price does not fire until price leaves and returns', async () => {
  let stored = [{ id: 'a', symbol: 'BTCUSDT', direction: 'reach', price: 100, firedAt: null }];
  const sent = [];
  const service = createPriceAlerts({
    readState: async () => ({ alerts: stored }),
    updateAlerts: async fired => { stored = stored.map(alert => fired.find(item => item.id === alert.id) || alert); },
    deliver: async (_alert, price) => { sent.push(price); return { commit: true, notice: 'local' }; },
    clock: () => 1000,
  });
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 100 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 100 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 101 } }]);
  assert.deepEqual(sent, []);
  assert.equal(stored[0].firedAt, null);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 100 } }]);
  await service.scan([{ type: 'quote', symbol: 'BTCUSDT', quote: { price: 100 } }]);
  assert.deepEqual(sent, [100]);
  assert.equal(stored[0].firedAt, 1000);
});

test('a failed reach notice is retried without requiring another touch', async () => {
  let stored = [{ id: 'a', symbol: 'INTC', direction: 'below', price: 85.38, firedAt: null }];
  let now = 1_000;
  let commits = false;
  const sent = [];
  const service = createPriceAlerts({
    readState: async () => ({ alerts: stored }),
    updateAlerts: async fired => { stored = stored.map(alert => fired.find(item => item.id === alert.id) || alert); },
    deliver: async (_alert, price) => { sent.push(price); return commits ? { commit: true, notice: 'feishu' } : { commit: false }; },
    clock: () => now,
  });
  await service.scan([{ type: 'quote', symbol: 'INTC', quote: { price: 89.85 } }]);
  await service.scan([{ type: 'quote', symbol: 'INTC', quote: { price: 85.2 } }]);
  assert.deepEqual(sent, [85.2]);
  assert.equal(stored[0].firedAt, null);
  await service.scan([{ type: 'quote', symbol: 'INTC', quote: { price: 85.1 } }]);
  assert.deepEqual(sent, [85.2]);
  now = 20_000;
  commits = true;
  await service.scan([{ type: 'quote', symbol: 'INTC', quote: { price: 85.1 } }]);
  assert.deepEqual(sent, [85.2, 85.2]);
  assert.equal(stored[0].firedAt, 20_000);
  assert.equal(stored[0].triggerPrice, 85.2);
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
  let options;
  const sent = await sendFeishuText(target, '【测试】山海', async (_url, init) => { options = init; return { ok: true, json: async () => ({ code: 0, StatusCode: 0 }) }; });
  assert.equal(sent.sent, true);
  assert.equal(options.redirect, 'error');
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

test('lark-cli is started without a shell and refuses command-line breakout text', async () => {
  let seen;
  const result = await runLark(['auth', 'status', '--json'], {
    exists: () => true,
    env: { LARK_CLI_SCRIPT: 'C:/lark/run.js' },
    spawnImpl(command, args, options) {
      seen = { command, args, shell: options.shell };
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });
  assert.equal(result.code, 0);
  assert.equal(seen.shell, false);
  assert.equal(seen.command, process.execPath);
  assert.deepEqual(seen.args.slice(1), ['auth', 'status', '--json']);
  let spawned = false;
  const rejected = await runLark(['im', '--text', 'price%\r\ncalc'], {
    exists: () => true,
    env: { LARK_CLI_SCRIPT: 'C:/lark/run.js' },
    spawnImpl() { spawned = true; throw new Error('should not spawn'); },
  });
  assert.equal(spawned, false);
  assert.equal(rejected.code, -1);
});

test('public quotes are polled in a few seconds rather than once a minute', () => {
  assert.equal(QUOTE_POLL_MS, 3000);
  assert.ok(QUOTE_POLL_MS <= 5000);
});
