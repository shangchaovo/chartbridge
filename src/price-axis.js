// KLineCharts 9.8.12 zooms the time scale on vertical wheel only when the pointer
// is over the main plot. The price scale already zooms while dragging; the wheel
// path never calls that same range update.

export function wheelScale(event) {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return 0;
  let delta = -(Number(event.deltaY) / 100);
  if (event.deltaMode === 1) delta *= 32;
  else if (event.deltaMode === 2) delta *= 120;
  if (!Number.isFinite(delta) || delta === 0) return 0;
  return Math.sign(delta) * Math.min(1, Math.abs(delta));
}

export function nextPriceRange(range, scale, convertToRealValue = value => value) {
  if (!range || !(range.range > 0) || !Number.isFinite(scale) || scale === 0) return null;
  const factor = 0.8 ** scale;
  const mid = (range.from + range.to) / 2;
  const minRange = Math.max(Math.abs(mid) * 1e-6, 1e-8);
  const maxRange = Math.max(Math.abs(mid) * 200, range.range * 80, minRange * 2);
  const next = Math.min(maxRange, Math.max(minRange, range.range * factor));
  const shift = (next - range.range) / 2;
  const from = range.from - shift;
  const to = range.to + shift;
  const realFrom = convertToRealValue(from);
  const realTo = convertToRealValue(to);
  if (![from, to, realFrom, realTo, next].every(Number.isFinite) || !(to > from)) return null;
  return { from, to, range: to - from, realFrom, realTo, realRange: realTo - realFrom };
}
