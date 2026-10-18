export const DRAWING_PANEL_STORAGE_KEY = 'shanhai-drawing-panel-position';

export function clampLegend(position, bounds, size) {
  const width = Math.max(0, Number(bounds?.width) || 0);
  const height = Math.max(0, Number(bounds?.height) || 0);
  const boxWidth = Math.max(0, Number(size?.width) || 0);
  const boxHeight = Math.max(0, Number(size?.height) || 0);
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Math.min(Math.max(0, Number.isFinite(x) ? x : 0), Math.max(0, width - boxWidth)),
    y: Math.min(Math.max(0, Number.isFinite(y) ? y : 0), Math.max(0, height - boxHeight)),
  };
}

export function clampBox(position, box) {
  const minX = Number.isFinite(box?.minX) ? box.minX : 0;
  const minY = Number.isFinite(box?.minY) ? box.minY : 0;
  const maxX = Number.isFinite(box?.maxX) ? box.maxX : minX;
  const maxY = Number.isFinite(box?.maxY) ? box.maxY : minY;
  const x = Number(position?.x);
  const y = Number(position?.y);
  return {
    x: Math.min(Math.max(minX, Number.isFinite(x) ? x : minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(minY, Number.isFinite(y) ? y : minY), Math.max(minY, maxY)),
  };
}

export function readLegendPosition(storage) {
  try {
    const value = JSON.parse(storage.getItem(DRAWING_PANEL_STORAGE_KEY) || '');
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) return { x: value.x, y: value.y };
  } catch { /* A broken saved position falls back to the chart corner. */ }
  return { x: 8, y: 8 };
}

export function writeLegendPosition(storage, position) {
  storage.setItem(DRAWING_PANEL_STORAGE_KEY, JSON.stringify({ x: position.x, y: position.y }));
}
