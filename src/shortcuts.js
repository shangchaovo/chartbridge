// TradingView-style chart shortcuts. Matching is pure so the keys can be tested
// without a chart. Labels stay in Chinese because the terminal UI is Chinese.
export const SHORTCUTS = [
  {id:'search', label:'搜索品种', display:'/'},
  {id:'trend', label:'趋势线', display:'Alt T'},
  {id:'horizontal', label:'水平线', display:'Alt H'},
  {id:'vertical', label:'垂直线', display:'Alt V'},
  {id:'cross', label:'十字线', display:'Alt C'},
  {id:'fib', label:'斐波那契回撤', display:'Alt F'},
  {id:'rect', label:'矩形', display:'Alt+Shift+R'},
  {id:'note', label:'文字标注', display:'Alt N'},
  {id:'ruler', label:'时间与价格区间', display:'Alt+M'},
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

const altKeys = {t:'trend', h:'horizontal', v:'vertical', c:'cross', f:'fib', n:'note', l:'lock', g:'fit', m:'ruler', y:'ray', e:'extended', p:'channel', w:'price-channel', o:'circle', k:'price-line', u:'price-range'};
const altShiftKeys = {r:'rect', h:'horizontal-ray', s:'horizontal-segment', f:'fib-extension', o:'triangle', a:'arrow', k:'price-tag', d:'date-range'};

function typingTarget(event) {
  const node = event.target;
  return Boolean(node?.closest?.('input,textarea,select,[contenteditable="true"]'));
}

export function matchShortcut(event) {
  if (!event || event.isComposing) return null;
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
  if (event.altKey && !mod && event.shiftKey && altShiftKeys[lower]) return altShiftKeys[lower];
  if (event.altKey && !mod && !event.shiftKey && lower === 'r') return 'reset';
  if (event.altKey && !mod && !event.shiftKey && lower === 'a') return 'alert';
  if (!mod && !event.altKey && event.shiftKey && lower === 't') return 'lock-cursor';
  if (event.altKey && !mod && !event.shiftKey && altKeys[lower]) return altKeys[lower];
  if (!mod && !event.altKey && key === '/') return 'search';
  if (!mod && !event.altKey && key === 'ArrowLeft') return 'pan-left';
  if (!mod && !event.altKey && key === 'ArrowRight') return 'pan-right';
  if (!mod && !event.altKey && (key === '+' || key === '=')) return 'zoom-in';
  if (!mod && !event.altKey && (key === '-' || key === '_')) return 'zoom-out';
  if (!mod && !event.altKey && key === ',') return 'interval-prev';
  if (!mod && !event.altKey && key === '.') return 'interval-next';
  return null;
}
