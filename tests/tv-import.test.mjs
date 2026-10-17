import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importTradingViewConfig, normalizeImportedSymbol } from '../src/tv-import.js';
import { activateSymbolMarks, symbolLetters, symbolMark } from '../src/symbol-mark.js';

test('exchange prefixes become local symbols and unknown lines are dropped', () => {
  assert.equal(normalizeImportedSymbol('BINANCE:BTCUSDT'), 'BTCUSDT');
  assert.equal(normalizeImportedSymbol('NASDAQ:AAPL'), 'AAPL');
  assert.equal(normalizeImportedSymbol('HKEX:0700'), '0700.HK');
  assert.equal(normalizeImportedSymbol('SSE:600519'), '600519.SS');
  assert.equal(normalizeImportedSymbol('not a symbol'), '');
});

test('sample file merges into the current watchlist and records unrecognized fields', () => {
  const text = readFileSync(new URL('../examples/tradingview-import.sample.json', import.meta.url), 'utf8');
  const result = importTradingViewConfig(text, { watchlist: ['BTCUSDT', 'DOGEUSDT'], supportedIndicators: ['EMA', 'VOL', 'RSI'] });
  assert.deepEqual(result.watchlist.slice(0, 2), ['BTCUSDT', 'DOGEUSDT']);
  assert.ok(result.added.includes('ETHUSDT'));
  assert.ok(result.added.includes('AAPL'));
  assert.ok(result.added.includes('0700.HK'));
  assert.equal(result.symbol, 'ETHUSDT');
  assert.equal(result.interval, '4h');
  assert.equal(result.chartType, 'candle_hollow');
  assert.deepEqual(result.indicators, ['EMA', 'VOL']);
  assert.ok(result.ignored.some(item => item.includes('社区脚本')));
  assert.ok(result.ignored.includes('session'));
  assert.ok(result.ignored.includes('adjustment'));
});

test('plain text watchlists import one symbol per line', () => {
  const result = importTradingViewConfig('BINANCE:SOLUSDT\n# comment\nNYSE:IBM\n', { watchlist: [], supportedIndicators: [] });
  assert.deepEqual(result.added, ['SOLUSDT', 'IBM']);
});

test('crypto and stock marks stay short and local', () => {
  assert.equal(symbolLetters('BTCUSDT'), '₿');
  assert.equal(symbolLetters('ETHUSDT'), 'Ξ');
  assert.equal(symbolLetters('AAPL'), 'A');
  assert.equal(symbolLetters('UNKNOWN'), 'U');
  assert.match(symbolMark('BTCUSDT'), /\/src\/assets\/logos\/btc\.svg/);
  assert.match(symbolMark('AAPL'), /\/src\/assets\/logos\/aapl\.png/);
  assert.doesNotMatch(symbolMark('BTCUSDT'), /https?:/);
  assert.doesNotMatch(symbolMark('NOICON'), /<img/);
  assert.doesNotMatch(symbolMark('PEPEUSDT'), /<img/);
  assert.match(symbolMark('NOICON'), /<text[^>]*>N<\/text>/);
  const removed = [];
  const img = { complete: true, naturalWidth: 0, remove() { removed.push(this); }, addEventListener() {} };
  activateSymbolMarks({ querySelectorAll: () => [img] });
  assert.equal(removed.length, 1);
});
