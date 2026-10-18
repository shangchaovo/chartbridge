import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPythFeed } from '../server/pyth-feed.mjs';

const NOW = Date.parse('2026-10-18T00:00:00Z');
const response = data => new Response(JSON.stringify(data));
const bars = times => ({ s: 'ok', t: times, o: times.map(() => 2600), h: times.map(() => 2602), l: times.map(() => 2598), c: times.map(() => 2601) });
async function fixture(context, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'shanhai-pyth-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return { path: join(dir, 'pyth.json'), ...options };
}

test('Pyth configuration verifies gold before persisting and never exposes the key in public status or URL', async context => {
  const options = await fixture(context);
  const feed = createPythFeed({ ...options, env: {}, clock: () => NOW, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).hostname, 'pyth.dourolabs.app');
    assert.equal(new URL(url).pathname, '/v1/fixed_rate@200ms/history');
    assert.equal(new URL(url).searchParams.get('symbol'), 'Metal.XAU/USD');
    assert.equal(init.headers.Authorization, 'Bearer test-secret-key'); assert.equal(init.redirect, 'error');
    assert.ok(!String(url).includes('test-secret-key'));
    return response(bars([NOW / 1000 - 86400, NOW / 1000 - 172800]));
  } });
  assert.equal((await feed.status()).configured, false);
  const saved = await feed.save('test-secret-key');
  assert.equal(saved.configured, true); assert.ok(saved.verifiedAt); assert.equal(saved.sample.count, 2);
  assert.ok(!JSON.stringify(saved).includes('test-secret-key'));
  assert.ok(!JSON.stringify(await feed.status()).includes('test-secret-key'));
  assert.equal(JSON.parse(await readFile(options.path, 'utf8')).apiKey, 'test-secret-key');
});

test('invalid or unentitled keys cannot replace working configuration and upstream bodies are not reflected', async context => {
  const options = await fixture(context); let mode = 200;
  const feed = createPythFeed({ ...options, env: {}, clock: () => NOW, fetchImpl: async () => mode === 200 ? response(bars([NOW / 1000 - 86400, NOW / 1000 - 172800])) : new Response('secret-from-upstream', { status: mode }) });
  await feed.save('working-key');
  const original = await readFile(options.path, 'utf8');
  for (const [status, code] of [[401, 'FEED_AUTH_REQUIRED'], [403, 'FEED_NOT_ENTITLED'], [429, 'FEED_RATE_LIMIT']]) {
    mode = status;
    await assert.rejects(feed.save('replacement-key'), error => error.code === code && !JSON.stringify(error).includes('secret-from-upstream'));
    assert.equal(await readFile(options.path, 'utf8'), original);
  }
});

test('short Pyth pages and closed-market windows do not exhaust history, and the before cursor is exclusive', async context => {
  const options = await fixture(context); let calls = 0; const requests = [];
  const feed = createPythFeed({ ...options, env: { PYTH_PRO_API_KEY: 'key' }, clock: () => NOW, fetchImpl: async url => {
    const query = new URL(url).searchParams; requests.push(query); calls++;
    const end = Number(query.get('to'));
    if (calls === 1) return response({ s: 'no_data' });
    return response(bars([end - 86400]));
  } });
  const before = NOW - 86400000;
  const value = await feed.candles({ limit: 2, before });
  assert.equal(calls, 3); assert.equal(value.meta.exhausted, false);
  assert.equal(Number(requests[0].get('to')), before / 1000 - 1);
  assert.ok(value.candles.every(row => row.timestamp < before));
  assert.ok(value.candles[0].timestamp < value.candles[1].timestamp);
  assert.ok(value.meta.warnings.some(text => text.includes('成交量')));
  assert.equal(value.quote.changePercent, null);
});

test('Pyth rejects malformed OHLC arrays instead of fabricating or switching the gold feed', async context => {
  const options = await fixture(context);
  const feed = createPythFeed({ ...options, env: { PYTH_PRO_API_KEY: 'key' }, fetchImpl: async () => response({ s: 'ok', t: [1, 2], o: [1], h: [2], l: [0], c: [1] }) });
  await assert.rejects(feed.candles({ limit: 2 }), { code: 'INVALID_UPSTREAM_RESPONSE' });
  await assert.rejects(feed.candles({ symbol: 'PYTH:UNKNOWN', limit: 2 }), { code: 'UNSUPPORTED_SYMBOL' });
  const empty = createPythFeed({ ...options, env: { PYTH_PRO_API_KEY: 'key' }, fetchImpl: async () => response({ s: 'no_data' }) });
  await assert.rejects(empty.candles({ limit: 2 }), { code: 'FEED_HISTORY_UNAVAILABLE' });
  for (const bad of [null, '', false, 0]) {
    const malformed = createPythFeed({ ...options, env: { PYTH_PRO_API_KEY:'key' }, fetchImpl: async () => response({ ...bars([NOW/1000-86400,NOW/1000-172800]), o:[bad,2600] }) });
    await assert.rejects(malformed.candles({limit:2}),{code:'INVALID_UPSTREAM_RESPONSE'});
  }
});
