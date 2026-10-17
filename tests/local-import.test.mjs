import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChartFragments } from '../server/tv-local.mjs';
import { normalizeImportedSymbol } from '../src/tv-import.js';
import { chatCompletionsUrl, parseAgentAnnotations, publicAgentStatus } from '../server/agent-mark.mjs';

test('local TradingView text yields tickers and leaves unresolved ids unimported', () => {
  const found = extractChartFragments('chart NASDAQ:AAPL BATS:AAPL symbol=COINBASE%3ABTCUSD watchlist":[{"id":"0.2kYEUc3OYKI7"}]');
  assert.deepEqual(found.symbols, ['NASDAQ:AAPL', 'BATS:AAPL', 'COINBASE:BTCUSD']);
  assert.deepEqual(found.indicators, []);
  assert.ok(found.ignored.includes('自选编号'));
  assert.equal(normalizeImportedSymbol('BATS:AAPL'), 'AAPL');
  assert.equal(normalizeImportedSymbol('COINBASE:BTCUSD'), 'BTCUSD');
});

test('agent status hides the key and annotations stay near the real close', () => {
  assert.equal(publicAgentStatus({ apiKey: 'secret', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }).configured, true);
  assert.equal('apiKey' in publicAgentStatus({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }), false);
  assert.match(publicAgentStatus({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }).missing[0], /API key/);
  assert.equal(chatCompletionsUrl('https://api.openai.com/v1').pathname, '/v1/chat/completions');
  const marks = parseAgentAnnotations('{"annotations":[{"kind":"hline","price":101,"text":"压力"},{"kind":"hline","price":1,"text":"离谱"}]}', 100);
  assert.equal(marks.length, 1);
  assert.equal(marks[0].text, '压力');
});
