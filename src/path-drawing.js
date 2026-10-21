// Path stays open. Polyline can close by snapping the last click back to the
// first anchor; Esc, right-click and double-click leave it open.
export const PATH_NAMES = Object.freeze(['localPath', 'localPolyline']);
export const MAX_PATH_POINTS = 64;
export const isPath = name => PATH_NAMES.includes(name);
export const isPolyline = name => name === 'localPolyline';

const validPoint = point => Boolean(point) && Number.isFinite(point.value) && (Number.isFinite(point.timestamp) || Number.isInteger(point.dataIndex));

export function samePathAnchor(a, b) {
  if (!validPoint(a) || !validPoint(b) || a.value !== b.value) return false;
  if (Number.isFinite(a.timestamp) || Number.isFinite(b.timestamp)) return a.timestamp === b.timestamp;
  return a.dataIndex === b.dataIndex;
}

export function pathSettings(value) {
  if (value == null) return {closed: false, fill: true};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('折线参数无效。');
  for (const key of Object.keys(value)) if (key !== 'closed' && key !== 'fill') throw new Error('折线参数无效。');
  if (value.closed !== undefined && typeof value.closed !== 'boolean') throw new Error('折线闭合状态无效。');
  if (value.fill !== undefined && typeof value.fill !== 'boolean') throw new Error('折线填充状态无效。');
  return {closed: value.closed === true, fill: value.fill !== false};
}

export function finalizePathPoints(points, {closed = false, dropLast = false} = {}) {
  const clean = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!validPoint(point)) continue;
    const next = {...(Number.isFinite(point.timestamp) ? {timestamp: point.timestamp} : {dataIndex: point.dataIndex}), value: point.value};
    if (!clean.length || !samePathAnchor(clean.at(-1), next)) clean.push(next);
  }
  if (dropLast && clean.length) clean.pop();
  if (clean.length >= 2 && samePathAnchor(clean[0], clean.at(-1))) {
    clean.pop();
    closed = true;
  }
  const capped = clean.slice(0, MAX_PATH_POINTS);
  if (capped.length < 2) return null;
  if (closed && capped.length < 3) closed = false;
  return {points: capped, closed};
}

const colorOf = overlay => overlay.styles?.line?.color || '#2962ff';
const fillOf = color => /^#[\da-f]{6}$/i.test(color) ? `${color}24` : 'rgba(41,98,255,.14)';

export function pathFigures({coordinates, overlay}) {
  const pts = coordinates.filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (pts.length < 2) return [];
  const color = colorOf(overlay), size = overlay.styles?.line?.size || 1, style = overlay.styles?.line?.style === 'dashed' ? 'dashed' : 'solid';
  let closed = false, fill = false;
  if (isPolyline(overlay.name) && !overlay.isDrawing?.()) {
    try {
      const settings = pathSettings(overlay.extendData);
      closed = settings.closed;
      fill = settings.fill;
    } catch { closed = false; }
  }
  if (closed && pts.length >= 3) return [{type: 'polygon', key: 'path-stroke', attrs: {coordinates: pts}, styles: {style: fill ? 'stroke_fill' : 'stroke', color: fill ? fillOf(color) : 'transparent', borderColor: color, borderSize: size, borderStyle: style}}];
  return [{type: 'line', key: 'path-stroke', attrs: {coordinates: pts}, styles: {color, size, style}}];
}

export function registerPathOverlays(register, {toPixel} = {}) {
  const base = {totalStep: MAX_PATH_POINTS + 1, needDefaultPointFigure: true, styles: {line: {color: '#2962ff', size: 1, style: 'solid'}}, createPointFigures: pathFigures};
  register({...base, name: 'localPath'});
  register({...base, name: 'localPolyline', onDrawing({overlay}) {
    if (typeof toPixel !== 'function') return;
    const index = overlay.currentStep - 1;
    if (index < 3) return;
    const placed = overlay.points[index], first = overlay.points[0];
    const start = placed && first ? toPixel(first) : null, current = placed ? toPixel(placed) : null;
    if (!start || !current || ![start.x, start.y, current.x, current.y].every(Number.isFinite)) return;
    if (Math.hypot(start.x - current.x, start.y - current.y) > 12) return;
    const fill = overlay.extendData && typeof overlay.extendData === 'object' && !Array.isArray(overlay.extendData) ? overlay.extendData.fill !== false : true;
    overlay._pathSnap = true;
    overlay.extendData = {closed: true, fill};
    overlay.currentStep = overlay.totalStep - 1;
  }});
}
