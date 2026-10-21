// Anchors 1 and 2 are the ends. Curve bends toward anchor 3, double curve uses
// anchors 3 and 4 as Bezier controls, and an arc passes through anchor 3.
export const CURVE_POINTS = Object.freeze({localArc: 3, localCurve: 3, localDoubleCurve: 4});
export const CURVE_NAMES = Object.freeze(Object.keys(CURVE_POINTS));
export const isCurve = name => Object.hasOwn(CURVE_POINTS, name);
const SAMPLES = 64;

export function curveSettings(value, name) {
  if (value == null) return {fill: name === 'localArc'};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('曲线参数无效。');
  for (const key of Object.keys(value)) if (key !== 'fill') throw new Error('曲线参数无效。');
  if (value.fill !== undefined && typeof value.fill !== 'boolean') throw new Error('曲线填充状态无效。');
  return {fill: value.fill === undefined ? name === 'localArc' : value.fill};
}

const lerp = (from, to, t) => from + (to - from) * t;
export function bezierPoints([start, end, ...controls], samples = SAMPLES) {
  return Array.from({length: samples + 1}, (_, index) => {
    const t = index / samples, u = 1 - t;
    if (controls.length === 1) {
      const [c] = controls;
      return {x: u * u * start.x + 2 * u * t * c.x + t * t * end.x, y: u * u * start.y + 2 * u * t * c.y + t * t * end.y};
    }
    if (controls.length === 2) {
      const [c1, c2] = controls;
      return {x: u ** 3 * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x, y: u ** 3 * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y};
    }
    return {x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t)};
  });
}

// Circle through start, mid and end in pixel space; nearly collinear anchors
// fall back to the chord so a huge radius never leaves the pane.
export function arcPoints(start, end, mid, samples = SAMPLES) {
  const d = 2 * (start.x * (end.y - mid.y) + end.x * (mid.y - start.y) + mid.x * (start.y - end.y));
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (!chord || Math.abs(d) < 1e-6) return [start, end];
  const sq = point => point.x * point.x + point.y * point.y;
  const cx = (sq(start) * (end.y - mid.y) + sq(end) * (mid.y - start.y) + sq(mid) * (start.y - end.y)) / d;
  const cy = (sq(start) * (mid.x - end.x) + sq(end) * (start.x - mid.x) + sq(mid) * (end.x - start.x)) / d;
  const r = Math.hypot(start.x - cx, start.y - cy);
  if (r > chord * 1000) return [start, end];
  const turn = 2 * Math.PI, norm = angle => ((angle % turn) + turn) % turn;
  const from = Math.atan2(start.y - cy, start.x - cx), ccw = norm(Math.atan2(end.y - cy, end.x - cx) - from);
  const sweep = norm(Math.atan2(mid.y - cy, mid.x - cx) - from) < ccw ? ccw : ccw - turn;
  return Array.from({length: samples + 1}, (_, index) => {
    const angle = from + sweep * index / samples;
    return {x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)};
  });
}

const colorOf = overlay => overlay.styles?.line?.color || '#2962ff';
const fillOf = color => /^#[\da-f]{6}$/i.test(color) ? `${color}24` : 'rgba(41,98,255,.14)';

export function curveFigures({coordinates, overlay}) {
  const pts = coordinates.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (pts.length < 2) return [];
  const color = colorOf(overlay), size = overlay.styles?.line?.size || 1, style = overlay.styles?.line?.style === 'dashed' ? 'dashed' : 'solid';
  const [start, end, ...rest] = pts;
  const curve = overlay.name === 'localArc' ? (rest[0] ? arcPoints(start, end, rest[0]) : [start, end]) : bezierPoints([start, end, ...rest.slice(0, overlay.name === 'localDoubleCurve' ? 2 : 1)]);
  const figures = [];
  let fill = false;
  try { fill = curveSettings(overlay.extendData, overlay.name).fill; } catch { fill = false; }
  if (fill && curve.length > 2) figures.push({type: 'polygon', key: 'curve-fill', attrs: {coordinates: curve}, styles: {style: 'fill', color: fillOf(color)}, ignoreEvent: true});
  figures.push({type: 'line', key: 'curve-stroke', attrs: {coordinates: curve}, styles: {color, size, style}});
  if (overlay.name !== 'localArc' && overlay.isDrawing?.() && rest.length) {
    const guides = overlay.name === 'localDoubleCurve' ? [[start, rest[0]], ...(rest[1] ? [[end, rest[1]]] : [])] : [[start, rest[0]], [rest[0], end]];
    for (const guide of guides) figures.push({type: 'line', attrs: {coordinates: guide}, styles: {color, size: 1, style: 'dashed'}, ignoreEvent: true});
  }
  return figures;
}

export function registerCurveOverlays(register) {
  for (const [name, points] of Object.entries(CURVE_POINTS)) register({name, totalStep: points + 1, needDefaultPointFigure: true, styles: {line: {color: '#2962ff', size: 1, style: 'solid'}}, createPointFigures: curveFigures});
}
