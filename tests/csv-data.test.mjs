import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCandlesCsv, exportCandlesCsv } from '../src/csv-data.js';

const header = 'timestamp,open,high,low,close,volume';
const row = '1704067200000,10,12,9,11,100';
const expected = { timestamp: 1704067200000, open: 10, high: 12, low: 9, close: 11, volume: 100 };

test('BOM, CRLF, Chinese aliases and quoted fields import together', () => {
  const csv = '\uFEFF"日期","开盘","最高","最低","收盘","成交量","说明"\r\n"2024-01-01","10","12","9","11","100","带逗号, 带""引号""\r\n第二行"\r\n';
  const result = parseCandlesCsv(csv);
  assert.deepEqual(result.candles, [expected]);
  assert.ok(result.warnings.some(warning => warning.includes('说明')));
});

test('seconds, milliseconds and explicit offsets describe the same instant', () => {
  for (const timestamp of ['1704067200', '1704067200000', '2024-01-01T00:00:00Z', '2024-01-01T08:00:00+08:00', '2023-12-31T19:00:00-0500']) {
    const result = parseCandlesCsv(`${header}\n${timestamp},10,12,9,11,100`);
    assert.deepEqual(result.candles, [expected]);
    assert.deepEqual(result.warnings, []);
  }
});

test('timezone-free datetime is UTC and warns; a trading date is UTC without ambiguity', () => {
  const datetime = parseCandlesCsv(`${header}\n2024-01-01 00:00:00,10,12,9,11,100`);
  const date = parseCandlesCsv(`${header}\n2024-01-01,10,12,9,11,100`);
  assert.equal(datetime.candles[0].timestamp, expected.timestamp);
  assert.ok(datetime.warnings.some(warning => warning.includes('第 2 行') && warning.includes('UTC')));
  assert.deepEqual(date.candles, [expected]);
  assert.deepEqual(date.warnings, []);
});

test('unsorted rows sort and identical duplicates deduplicate with warnings', () => {
  const result = parseCandlesCsv(`${header}\n1704153600000,20,22,19,21,200\n${row}\n${row}`);
  assert.deepEqual(result.candles.map(bar => bar.timestamp), [1704067200000, 1704153600000]);
  assert.ok(result.warnings.some(warning => warning.includes('升序')));
  assert.ok(result.warnings.some(warning => warning.includes('第 4 行') && warning.includes('第 3 行')));
  assert.throws(() => parseCandlesCsv(`${header}\n${row}\n1704067200000,10,12,9,12,100`), /第 3 行.*第 2 行.*冲突/);
});

test('missing volume column or value becomes zero with an explicit warning', () => {
  const missingColumn = parseCandlesCsv('time,open,high,low,close\n1704067200,10,12,9,11');
  const missingValue = parseCandlesCsv(`${header}\n1704067200000,10,12,9,11,`);
  for (const result of [missingColumn, missingValue]) {
    assert.equal(result.candles[0].volume, 0);
    assert.ok(result.warnings.some(warning => warning.includes('成交量') && warning.includes('0')));
  }
});

test('invalid rows fail with physical line numbers, including after quoted newlines', () => {
  const csv = `${header},note\r\n${row},"line one\r\nline two"\r\n1704153600000,0,12,9,11,100,invalid`;
  assert.throws(() => parseCandlesCsv(csv), /第 4 行.*大于零/);
  assert.throws(() => parseCandlesCsv(`${header}\n1704067200000,10,9,8,11,100`), /第 2 行.*最高/);
  assert.throws(() => parseCandlesCsv(`${header}\n1704067200000,10,12,9,11,-1`), /第 2 行.*成交量/);
  assert.throws(() => parseCandlesCsv(`${header}\n1704067200000,10,12,9,11`), /第 2 行.*6 列/);
  assert.throws(() => parseCandlesCsv(`${header}\n1704067200000,10,12,9,11,NaN`), /第 2 行.*有效数字/);
});

test('nonexistent dates, ambiguous formats and malformed CSV fail explicitly', () => {
  for (const timestamp of ['2024-02-30', '2023-02-29T00:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T00:00:00+25:00', '01/02/2024']) {
    assert.throws(() => parseCandlesCsv(`${header}\n${timestamp},10,12,9,11,100`), /第 2 行/);
  }
  assert.throws(() => parseCandlesCsv(`${header}\n"1704067200000,10,12,9,11,100`), /第 2 行.*未闭合/);
  assert.throws(() => parseCandlesCsv(`${header}\n"1704067200000"x,10,12,9,11,100`), /第 2 行.*引号结束/);
  assert.throws(() => parseCandlesCsv('time,date,open,high,low,close\n2024-01-01,2024-01-01,1,1,1,1'), /第 1 行.*多个 timestamp/);
  assert.throws(() => parseCandlesCsv('time,close\n2024-01-01,10'), /第 1 行.*缺少 open/);
  assert.throws(() => parseCandlesCsv(header), /没有 K 线数据/);
});

test('canonical CSV exports and round-trips without losing OHLCV precision', () => {
  const candles = [expected, { timestamp: 1704153600000, open: 1.23456789, high: 2, low: 0.000001, close: 1.5, volume: 0 }];
  const csv = exportCandlesCsv(candles);
  assert.equal(csv.split('\r\n')[0], header);
  assert.deepEqual(parseCandlesCsv(csv), { candles, warnings: [] });
  assert.throws(() => exportCandlesCsv([{ ...expected, high: 1 }]), /最高/);
  assert.throws(() => exportCandlesCsv([expected, expected]), /严格递增/);
});

test('early epoch exports use explicit ISO so seconds inference cannot alter dates', () => {
  const candles = [{ ...expected, timestamp: 60000 }, { ...expected, timestamp: 86400000 }];
  const csv = exportCandlesCsv(candles);
  assert.ok(csv.includes('1970-01-01T00:01:00.000Z'));
  assert.deepEqual(parseCandlesCsv(csv), { candles, warnings: [] });
});
