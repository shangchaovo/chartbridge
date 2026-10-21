export const DRAWING_COLOR_STORAGE_KEY = 'shanhai-drawing-colors';
export const DEFAULT_DRAWING_COLOR = '#2962ff';
export const QUICK_DRAWING_COLORS = Object.freeze([['#f23645', '红色'], ['#089981', '绿色']]);
export const DRAWING_PALETTE = Object.freeze([
  '#ffffff','#f2f2f2','#e0e0e0','#bdbdbd','#9e9e9e','#787b86','#616161','#434651','#2a2e39','#131722',
  '#ffebee','#fff3e0','#fffde7','#f1f8e9','#e0f2f1','#e0f7fa','#e3f2fd','#e8eaf6','#f3e5f5','#fce4ec',
  '#ffcdd2','#ffe0b2','#fff9c4','#dcedc8','#b2dfdb','#b2ebf2','#bbdefb','#c5cae9','#e1bee7','#f8bbd0',
  '#ef9a9a','#ffcc80','#fff59d','#c5e1a5','#80cbc4','#80deea','#90caf9','#9fa8da','#ce93d8','#f48fb1',
  '#e57373','#ffb74d','#fff176','#aed581','#4db6ac','#4dd0e1','#64b5f6','#7986cb','#ba68c8','#f06292',
  '#f23645','#ff9800','#ffeb3b','#8bc34a','#089981','#00bcd4','#2962ff','#673ab7','#9c27b0','#e91e63',
  '#c62828','#ef6c00','#f9a825','#558b2f','#00897b','#00838f','#1565c0','#4527a0','#6a1b9a','#ad1457',
  '#b71c1c','#e65100','#f57f17','#33691e','#004d40','#006064','#0d47a1','#311b92','#4a148c','#880e4f',
]);

export function normalizeDrawingColor(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}
export function normalizeDrawingColors(value) {
  const recent = Array.isArray(value?.recent) ? [...new Set(value.recent.map(normalizeDrawingColor).filter(Boolean))].slice(0, 10) : [];
  return {color: normalizeDrawingColor(value?.color), recent};
}
export function readDrawingColors(storage) {
  try { return normalizeDrawingColors(JSON.parse(storage.getItem(DRAWING_COLOR_STORAGE_KEY) || '{}')); }
  catch { return normalizeDrawingColors(); }
}
export function rememberDrawingColor(storage, preferences, value) {
  const color = normalizeDrawingColor(value), current = normalizeDrawingColors(preferences);
  if (!color) return current;
  const next = {color, recent: [color, ...current.recent.filter(item => item !== color)].slice(0, 10)};
  try { storage.setItem(DRAWING_COLOR_STORAGE_KEY, JSON.stringify(next)); } catch {}
  return next;
}
// Apply the chosen color to both built-in figures and custom drawing tools.
export function drawingColorStyles(value, original = {}) {
  const styles = structuredClone(original || {}), color = normalizeDrawingColor(value);
  if (!color) return styles;
  styles.line = {...styles.line, color};
  styles.text = {...styles.text, color};
  for (const figure of ['rect', 'polygon', 'circle', 'arc']) {
    styles[figure] = {...styles[figure], borderColor: color, color: `${color}1f`};
  }
  return styles;
}

export function colorRgb(value) {
  const color = normalizeDrawingColor(value) || DEFAULT_DRAWING_COLOR;
  return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
}
export function rgbColor(values) {
  if (values.length !== 3 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return `#${values.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}
export function colorHsv(color) {
  const [r, g, b] = colorRgb(color).map(value => value / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return {h: (hue * 60 + 360) % 360, s: max ? delta / max : 0, v: max};
}
export function hsvColor({h, s, v}) {
  const hue = ((h % 360) + 360) % 360 / 60, c = v * s, x = c * (1 - Math.abs(hue % 2 - 1)), m = v - c;
  const channels = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(hue)];
  return rgbColor(channels.map(value => Math.round((value + m) * 255)));
}
