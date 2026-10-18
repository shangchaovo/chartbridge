import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChartFragments, extractWatchlists } from '../server/tv-local.mjs';
import { normalizeImportedSymbol } from '../src/tv-import.js';
import { chatCompletionsUrl, parseAgentAnnotations, publicAgentStatus } from '../server/agent-mark.mjs';

test('local TradingView text yields tickers and leaves unresolved ids unimported', () => {
  const found = extractChartFragments('chart NASDAQ:AAPL BATS:AAPL symbol=COINBASE%3ABTCUSD watchlist":[{"id":"0.2kYEUc3OYKI7"}]');
  assert.deepEqual(found.symbols, ['NASDAQ:AAPL', 'BATS:AAPL', 'COINBASE:BTCUSD']);
  assert.deepEqual(found.indicators, []);
  assert.ok(found.ignored.includes('自选编号'));
  assert.equal(normalizeImportedSymbol('BATS:AAPL'), 'AAPL');
  assert.equal(normalizeImportedSymbol('COINBASE:BTCUSD'), 'COINBASE:BTCUSD');
});

test('cached watchlists preserve exact codes and ignore unrelated history fragments and incomplete records', () => {
  const list = { id: 42, name: 'STOCK', type: 'colored', active: false, modified: '2026-10-18T01:00:00Z',
    symbols: ['###股票', 'NASDAQ:TSLA', 'BINANCE:SKHYNIXUSDT.P', 'BINANCE:LTCUSD.P', 'COINBASE:BTCUSD'] };
  const found = extractWatchlists(`noise NASDAQ:WRONG ${JSON.stringify(list)} tail {"id":9,"symbols":["NASDAQ:INCOMPLETE"]`);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'STOCK');
  assert.deepEqual(found[0].symbols, list.symbols.slice(1));
  assert.deepEqual(extractWatchlists('{"symbols":["NASDAQ:RECENT"]}'), []);
  assert.equal(normalizeImportedSymbol('BINANCE:SKHYNIXUSDT.P'), 'BINANCE:SKHYNIXUSDT');
  assert.equal(normalizeImportedSymbol('BINANCE:LTCUSD.P'), 'BINANCE:LTCUSD');
  assert.equal(normalizeImportedSymbol('BINANCE:TAOU', [{ symbol: 'BINANCE-SPOT:TAOU' }]), 'BINANCE-SPOT:TAOU');
});

test('agent status hides the key and annotations stay near the real close', () => {
  assert.equal(publicAgentStatus({ apiKey: 'secret', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }).configured, true);
  assert.equal('apiKey' in publicAgentStatus({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }), false);
  assert.match(publicAgentStatus({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }).missing[0], /API key/);
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1').pathname, '/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://127.0.0.1:11434/v1').pathname, '/v1/chat/completions');
  assert.throws(() => chatCompletionsUrl('https://user:secret@api.openai.com/v1'), /账号或密码/);
  assert.throws(() => chatCompletionsUrl('http://169.254.169.254/latest'), /元数据/);
  const marks = parseAgentAnnotations('{"annotations":[{"kind":"hline","price":101,"text":"压力"},{"kind":"hline","price":1,"text":"离谱"}]}', 100);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].text, '压力');
});
