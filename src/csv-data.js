const HEADER = ['timestamp', 'open', 'high', 'low', 'close', 'volume'];
const ALIASES = new Map([
  ['timestamp', 'timestamp'], ['time', 'timestamp'], ['date', 'timestamp'], ['日期', 'timestamp'], ['时间', 'timestamp'],
  ['open', 'open'], ['开盘', 'open'], ['high', 'high'], ['最高', 'high'],
  ['low', 'low'], ['最低', 'low'], ['close', 'close'], ['收盘', 'close'],
  ['volume', 'volume'], ['成交量', 'volume'],
]);
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const fail = (line, message) => { throw new Error(`CSV 第 ${line} 行：${message}`); };

// Parse records separately from data validation so quoted newlines retain their
// physical source line numbers. CRLF counts as one newline, including in quotes.
function records(text) {
  const result = [];
  let fields = [];
  let value = '';
  let state = 'plain';
  let line = 1;
  let startLine = 1;
  const finish = () => {
    fields.push(value);
    if (fields.length > 1 || fields[0].trim()) result.push({ fields, line: startLine });
    fields = [];
    value = '';
    state = 'plain';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') state = 'after-quote';
      else if (char === '\r' || char === '\n') {
        value += '\n';
        if (char === '\r' && text[i + 1] === '\n') i++;
        line++;
      } else value += char;
      continue;
    }
    if (char === ',') { fields.push(value); value = ''; state = 'plain'; }
    else if (char === '\r' || char === '\n') {
      finish();
      if (char === '\r' && text[i + 1] === '\n') i++;
      line++;
      startLine = line;
    } else if (state === 'after-quote') {
      if (char !== ' ' && char !== '\t') fail(line, '引号结束后只能出现逗号或换行。');
    } else if (char === '"') {
      if (value.trim()) fail(line, '字段内的双引号必须通过带引号字段转义。');
      value = '';
      state = 'quoted';
    } else value += char;
  }
  if (state === 'quoted') fail(startLine, '带引号字段未闭合。');
  finish();
  return result;
}

function parseTime(value, line, warnings) {
  if (NUMBER.test(value)) {
    const epoch = Number(value);
    // Contemporary 10-digit epochs are seconds; 13-digit epochs are milliseconds.
    const timestamp = epoch < 100000000000 ? epoch * 1000 : epoch;
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail(line, 'epoch 时间戳必须能表示为非负整数毫秒。');
    return timestamp;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const datetime = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?([Zz]|[+-]\d{2}:?\d{2})?$/.exec(value);
  const match = dateOnly || datetime;
  if (!match) fail(line, '时间须为秒/毫秒 epoch、YYYY-MM-DD 或 ISO 日期时间（建议带 Z 或 ±HH:mm 时区）。');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = datetime ? Number(match[4]) : 0;
  const minute = datetime ? Number(match[5]) : 0;
  const second = datetime ? Number(match[6] || 0) : 0;
  const millisecond = datetime ? Number((match[7] || '').padEnd(3, '0')) : 0;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) fail(line, '日期时间不存在或超出有效范围。');
  let timestamp = date.getTime();
  const zone = datetime && match[8];
  if (zone && zone.toUpperCase() !== 'Z') {
    const offset = zone.slice(1).replace(':', '');
    const hours = Number(offset.slice(0, 2));
    const minutes = Number(offset.slice(2));
    if (hours > 23 || minutes > 59) fail(line, '时区偏移无效。');
    timestamp -= (zone[0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60000;
  } else if (datetime && !zone) warnings.push(`第 ${line} 行日期时间未带时区，已按 UTC 解释。`);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail(line, '时间须不早于 1970-01-01 UTC。');
  return timestamp;
}

function validateBar(bar, line) {
  if (!Number.isSafeInteger(bar.timestamp) || bar.timestamp < 0) fail(line, '时间戳须为非负整数毫秒。');
  if (['open', 'high', 'low', 'close'].some(key => !Number.isFinite(bar[key]) || bar[key] <= 0)) fail(line, 'OHLC 价格必须为大于零的有限数字。');
  if (!Number.isFinite(bar.volume) || bar.volume < 0) fail(line, '成交量必须为非负有限数字。');
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) fail(line, '最高/最低价与开盘/收盘价不一致。');
}

/** Import comma-separated OHLCV. Naive ISO date-times use UTC with a warning. */
export function parseCandlesCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV 内容必须为字符串。');
  const rows = records(text.replace(/^\uFEFF/, ''));
  if (!rows.length) throw new Error('CSV 为空。');
  const header = rows[0];
  const columns = new Map();
  const warnings = [];
  const ignored = [];
  header.fields.forEach((field, index) => {
    const name = ALIASES.get(field.trim().toLowerCase());
    if (!name) { ignored.push(field.trim() || `第 ${index + 1} 列`); return; }
    if (columns.has(name)) fail(header.line, `有多个 ${name} 列，无法确定字段。`);
    columns.set(name, index);
  });
  for (const name of HEADER.slice(0, 5)) if (!columns.has(name)) fail(header.line, `缺少 ${name} 列。`);
  if (ignored.length) warnings.push(`已忽略非 OHLCV 列：${ignored.join('、')}。`);
  if (!columns.has('volume')) warnings.push('缺少成交量列，所有成交量已补为 0。');
  const byTime = new Map();
  let previousTimestamp = -1;
  let reordered = false;
  for (const row of rows.slice(1)) {
    if (row.fields.length !== header.fields.length) fail(row.line, `应有 ${header.fields.length} 列，实际为 ${row.fields.length} 列。`);
    const bar = {};
    for (const name of HEADER) {
      const value = columns.has(name) ? row.fields[columns.get(name)].trim() : '';
      if (name === 'timestamp') bar.timestamp = parseTime(value, row.line, warnings);
      else if (name === 'volume' && !value) {
        bar.volume = 0;
        if (columns.has('volume')) warnings.push(`第 ${row.line} 行缺少成交量，已补为 0。`);
      } else {
        if (!NUMBER.test(value)) fail(row.line, `${name} 不是有效数字。`);
        bar[name] = Number(value);
      }
    }
    validateBar(bar, row.line);
    const duplicate = byTime.get(bar.timestamp);
    if (duplicate) {
      if (HEADER.some(key => duplicate.bar[key] !== bar[key])) fail(row.line, `时间戳与第 ${duplicate.line} 行重复，但 OHLCV 数据冲突。`);
      warnings.push(`第 ${row.line} 行与第 ${duplicate.line} 行完全重复，已去重。`);
    } else byTime.set(bar.timestamp, { bar, line: row.line });
    if (bar.timestamp < previousTimestamp) reordered = true;
    previousTimestamp = bar.timestamp;
  }
  if (!byTime.size) throw new Error('CSV 表头后没有 K 线数据。');
  if (reordered) warnings.push('K 线原顺序并非时间递增，已按时间升序排列。');
  return { candles: [...byTime.values()].map(item => item.bar).sort((a, b) => a.timestamp - b.timestamp), warnings };
}

/** Export canonical OHLCV. Early dates use ISO to avoid epoch-unit ambiguity. */
export function exportCandlesCsv(candles) {
  if (!Array.isArray(candles)) throw new TypeError('K 线必须为数组。');
  const rows = candles.map((bar, index) => {
    if (!bar || typeof bar !== 'object') fail(index + 2, 'K 线数据无效。');
    validateBar(bar, index + 2);
    if (index > 0 && bar.timestamp <= candles[index - 1].timestamp) fail(index + 2, 'K 线时间必须严格递增。');
    return HEADER.map(key => key === 'timestamp' && bar.timestamp < 100000000000
      ? new Date(bar.timestamp).toISOString() : String(bar[key])).join(',');
  });
  return `${[HEADER.join(','), ...rows].join('\r\n')}\r\n`;
}
