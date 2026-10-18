// TradingView-style chart shortcuts. Matching is pure so the keys can be tested
// without a chart. Labels stay in Chinese because the terminal UI is Chinese.
// Shift-drag measuring is a mouse gesture, not a rebindable keyboard shortcut.
export const SHORTCUT_STORAGE_KEY = 'shanhai-shortcuts';
export const MEASURE_GESTURE = {id:'measure', label:'时间与价格区间', display:'Shift，再点两下'};

export const SHORTCUTS = [
  {id:'search', label:'搜索品种', display:'/'},
  {id:'trend', label:'趋势线', display:'Alt T'},
  {id:'horizontal', label:'水平线', display:'Alt H'},
  {id:'vertical', label:'垂直线', display:'Alt V'},
  {id:'cross', label:'十字线', display:'Alt C'},
  {id:'fib', label:'斐波那契回撤', display:'Alt F'},
  {id:'rect', label:'矩形', display:'Alt+Shift+R'},
  {id:'note', label:'文字标注', display:'Alt N'},
  {id:'ray', label:'射线', display:'Alt+Y'},
  {id:'extended', label:'延长线', display:'Alt+E'},
  {id:'horizontal-ray', label:'水平射线', display:'Alt+Shift+H'},
  {id:'horizontal-segment', label:'水平线段', display:'Alt+Shift+S'},
  {id:'channel', label:'平行通道', display:'Alt+P'},
  {id:'price-channel', label:'价格通道', display:'Alt+W'},
  {id:'fib-extension', label:'趋势斐波那契扩展', display:'Alt+Shift+F'},
  {id:'circle', label:'圆形', display:'Alt+O'},
  {id:'triangle', label:'三角形', display:'Alt+Shift+O'},
  {id:'arrow', label:'箭头', display:'Alt+Shift+A'},
  {id:'price-line', label:'价格线', display:'Alt+K'},
  {id:'price-tag', label:'价格标签', display:'Alt+Shift+K'},
  {id:'price-range', label:'价格区间', display:'Alt+U'},
  {id:'date-range', label:'时间区间', display:'Alt+Shift+D'},
  {id:'reset', label:'重置图表视图', display:'Alt+R'},
  {id:'alert', label:'在十字光标价格添加警报', display:'Alt+A'},
  {id:'lock-cursor', label:'按时间锁定或解除垂直光标线', display:'Shift+T'},
  {id:'undo', label:'撤销画线操作', display:'Ctrl/⌘ Z'},
  {id:'redo', label:'重做画线操作', display:'Ctrl/⌘ Shift Z · Ctrl Y'},
  {id:'delete', label:'删除选中的图形', display:'Delete / Backspace'},
  {id:'escape', label:'取消当前绘图 / 关闭菜单', display:'Esc'},
  {id:'save', label:'保存布局', display:'Ctrl/⌘ S'},
  {id:'hide', label:'隐藏或显示全部画线', display:'Ctrl Alt H'},
  {id:'lock', label:'锁定或解锁全部画线', display:'Alt L'},
  {id:'indicators', label:'打开技术指标', display:'Ctrl/⌘ I'},
  {id:'fit', label:'适应图表', display:'Alt G'},
  {id:'pan-left', label:'向左平移', display:'←'},
  {id:'pan-right', label:'向右平移', display:'→'},
  {id:'zoom-in', label:'放大 K 线', display:'+'},
  {id:'zoom-out', label:'缩小 K 线', display:'−'},
  {id:'interval-prev', label:'上一周期', display:','},
  {id:'interval-next', label:'下一周期', display:'.'},
  {id:'pine', label:'运行 Pine 编辑器脚本', display:'Ctrl/⌘ Enter'},
];

const chord = (key, alt=false, shift=false, ctrl=false) => ({key, alt, shift, ctrl});
const DEFAULT_CHORDS = {
  search:[chord('/')],
  trend:[chord('t', true)],
  horizontal:[chord('h', true)],
  vertical:[chord('v', true)],
  cross:[chord('c', true)],
  fib:[chord('f', true)],
  rect:[chord('r', true, true)],
  note:[chord('n', true)],
  ray:[chord('y', true)],
  extended:[chord('e', true)],
  'horizontal-ray':[chord('h', true, true)],
  'horizontal-segment':[chord('s', true, true)],
  channel:[chord('p', true)],
  'price-channel':[chord('w', true)],
  'fib-extension':[chord('f', true, true)],
  circle:[chord('o', true)],
  triangle:[chord('o', true, true)],
  arrow:[chord('a', true, true)],
  'price-line':[chord('k', true)],
  'price-tag':[chord('k', true, true)],
  'price-range':[chord('u', true)],
  'date-range':[chord('d', true, true)],
  reset:[chord('r', true)],
  alert:[chord('a', true)],
  'lock-cursor':[chord('t', false, true)],
  undo:[chord('z', false, false, true)],
  redo:[chord('z', false, true, true), chord('y', false, false, true), chord('y', false, true, true)],
  delete:[chord('Delete'), chord('Backspace')],
  escape:[chord('Escape')],
  save:[chord('s', false, false, true), chord('s', false, true, true)],
  hide:[chord('h', true, false, true)],
  lock:[chord('l', true)],
  indicators:[chord('i', false, false, true)],
  fit:[chord('g', true)],
  'pan-left':[chord('ArrowLeft'), chord('ArrowLeft', false, true)],
  'pan-right':[chord('ArrowRight'), chord('ArrowRight', false, true)],
  'zoom-in':[chord('+'), chord('='), chord('+', false, true), chord('=', false, true)],
  'zoom-out':[chord('-'), chord('_'), chord('-', false, true), chord('_', false, true)],
  'interval-prev':[chord(','), chord(',', false, true)],
  'interval-next':[chord('.'), chord('.', false, true)],
  pine:[chord('Enter', false, false, true)],
};

export const DRAWING_SHORTCUT_IDS = {
  segment:'trend', rayLine:'ray', straightLine:'extended', horizontalStraightLine:'horizontal',
  horizontalRayLine:'horizontal-ray', horizontalSegment:'horizontal-segment', verticalStraightLine:'vertical',
  crossLine:'cross', parallelStraightLine:'channel', priceChannelLine:'price-channel', fibonacciLine:'fib',
  fibExtension:'fib-extension', rect:'rect', localCircle:'circle', localTriangle:'triangle', arrowLine:'arrow',
  localNote:'note', priceLine:'price-line', simpleTag:'price-tag', priceRange:'price-range', dateRange:'date-range',
};

const KEY_LABELS = {ArrowLeft:'←', ArrowRight:'→', Delete:'Delete', Backspace:'Backspace', Escape:'Esc', Enter:'Enter', '-':'−'};
const NAMED_KEYS = {escape:'Escape', delete:'Delete', backspace:'Backspace', arrowleft:'ArrowLeft', arrowright:'ArrowRight', enter:'Enter'};

function typingTarget(event) {
  const node = event.target;
  return Boolean(node?.closest?.('input,textarea,select,[contenteditable="true"]'));
}

export function normalizeKey(key) {
  const raw = String(key || '');
  const lower = raw.toLowerCase();
  if (NAMED_KEYS[lower]) return NAMED_KEYS[lower];
  return lower.length === 1 ? lower : raw;
}

export function chordFromEvent(event) {
  if (!event) return null;
  const key = normalizeKey(event.key);
  if (!key || ['Shift','Control','Alt','Meta'].includes(event.key)) return null;
  return {key, alt:Boolean(event.altKey), shift:Boolean(event.shiftKey), ctrl:Boolean(event.ctrlKey || event.metaKey)};
}

export function sameChord(a, b) {
  return Boolean(a && b && a.key === b.key && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl);
}

export function formatChord(chordValue) {
  if (!chordValue?.key) return '未设置';
  const parts = [];
  if (chordValue.ctrl) parts.push('Ctrl/⌘');
  if (chordValue.alt) parts.push('Alt');
  if (chordValue.shift) parts.push('Shift');
  const key = KEY_LABELS[chordValue.key] || (chordValue.key.length === 1 ? chordValue.key.toUpperCase() : chordValue.key);
  parts.push(key);
  return parts.join('+');
}

export function normalizeChord(value) {
  if (!value || typeof value.key !== 'string') return null;
  const key = normalizeKey(value.key);
  if (!key) return null;
  return {key, alt:Boolean(value.alt), shift:Boolean(value.shift), ctrl:Boolean(value.ctrl)};
}

export function loadShortcutOverrides(storage) {
  try {
    const raw = JSON.parse(storage?.getItem?.(SHORTCUT_STORAGE_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const known = new Set(SHORTCUTS.map(item => item.id));
    const overrides = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!known.has(id)) continue;
      const next = normalizeChord(value);
      if (next) overrides[id] = next;
    }
    return overrides;
  } catch { return {}; }
}

function chordsFor(id, overrides={}) {
  return overrides[id] ? [overrides[id]] : (DEFAULT_CHORDS[id] || []);
}

export function shortcutConflict(id, chordValue, overrides={}) {
  const next = normalizeChord(chordValue);
  if (!next) return null;
  return SHORTCUTS.find(item => item.id !== id && chordsFor(item.id, overrides).some(itemChord => sameChord(itemChord, next))) || null;
}

export function eventMatches(id, event, overrides={}) {
  const next = chordFromEvent(event);
  if (!next) return false;
  const chords = overrides[id] ? [normalizeChord(overrides[id])] : (DEFAULT_CHORDS[id] || []);
  return chords.some(item => sameChord(item, next));
}

export function shortcutDisplay(id, overrides={}) {
  if (overrides[id]) return formatChord(overrides[id]);
  return SHORTCUTS.find(item => item.id === id)?.display || '';
}

export function toolShortcutLabel(name, overrides={}) {
  if (name === 'datePriceRange') return MEASURE_GESTURE.display;
  const id = DRAWING_SHORTCUT_IDS[name];
  return id ? shortcutDisplay(id, overrides) : '';
}

function matchDefault(event) {
  const key = String(event.key || '');
  const lower = key.toLowerCase();
  const mod = Boolean(event.metaKey || event.ctrlKey);
  if (mod && lower === 's' && !event.altKey) return 'save';
  if (typingTarget(event)) return null;
  if (key === 'Escape') return 'escape';
  if (mod && event.altKey && lower === 'h') return 'hide';
  if (mod && !event.altKey && lower === 'i') return 'indicators';
  if (mod && !event.altKey && (lower === 'z' || lower === 'y')) return lower === 'y' || event.shiftKey ? 'redo' : 'undo';
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (event.altKey && !mod && event.shiftKey && {r:'rect', h:'horizontal-ray', s:'horizontal-segment', f:'fib-extension', o:'triangle', a:'arrow', k:'price-tag', d:'date-range'}[lower]) return {r:'rect', h:'horizontal-ray', s:'horizontal-segment', f:'fib-extension', o:'triangle', a:'arrow', k:'price-tag', d:'date-range'}[lower];
  if (event.altKey && !mod && !event.shiftKey && lower === 'r') return 'reset';
  if (event.altKey && !mod && !event.shiftKey && lower === 'a') return 'alert';
  if (!mod && !event.altKey && event.shiftKey && lower === 't') return 'lock-cursor';
  if (event.altKey && !mod && !event.shiftKey && {t:'trend', h:'horizontal', v:'vertical', c:'cross', f:'fib', n:'note', l:'lock', g:'fit', y:'ray', e:'extended', p:'channel', w:'price-channel', o:'circle', k:'price-line', u:'price-range'}[lower]) return {t:'trend', h:'horizontal', v:'vertical', c:'cross', f:'fib', n:'note', l:'lock', g:'fit', y:'ray', e:'extended', p:'channel', w:'price-channel', o:'circle', k:'price-line', u:'price-range'}[lower];
  if (!mod && !event.altKey && key === '/') return 'search';
  if (!mod && !event.altKey && key === 'ArrowLeft') return 'pan-left';
  if (!mod && !event.altKey && key === 'ArrowRight') return 'pan-right';
  if (!mod && !event.altKey && (key === '+' || key === '=')) return 'zoom-in';
  if (!mod && !event.altKey && (key === '-' || key === '_')) return 'zoom-out';
  if (!mod && !event.altKey && key === ',') return 'interval-prev';
  if (!mod && !event.altKey && key === '.') return 'interval-next';
  if (mod && !event.altKey && key === 'Enter') return 'pine';
  return null;
}

export function matchShortcut(event, overrides={}) {
  if (!event || event.isComposing) return null;
  const custom = chordFromEvent(event);
  if (custom) {
    const hit = Object.entries(overrides).find(([, value]) => sameChord(value, custom));
    if (hit) return hit[0] === 'save' || !typingTarget(event) ? hit[0] : null;
  }
  const action = matchDefault(event);
  if (action && overrides[action]) return null;
  return action;
}
