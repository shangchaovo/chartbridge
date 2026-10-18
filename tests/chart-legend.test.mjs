import test from 'node:test';
import assert from 'node:assert/strict';
import { clampLegend, clampBox, readLegendPosition, writeLegendPosition, DRAWING_PANEL_STORAGE_KEY } from '../src/chart-legend.js';

test('locked-annotation panel stays inside the chart and remembers its position', () => {
  assert.deepEqual(clampLegend({ x: -20, y: 400 }, { width: 300, height: 200 }, { width: 80, height: 40 }), { x: 0, y: 160 });
  assert.deepEqual(clampLegend({ x: 10, y: 12 }, { width: 300, height: 200 }, { width: 80, height: 40 }), { x: 10, y: 12 });
  assert.deepEqual(clampBox({ x: 24, y: 10 }, { minX: 6, minY: 6, maxX: 640, maxY: 420 }), { x: 24, y: 10 });
  assert.deepEqual(clampBox({ x: -30, y: 900 }, { minX: 6, minY: 6, maxX: 640, maxY: 420 }), { x: 6, y: 420 });
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.deepEqual(readLegendPosition(storage), { x: 8, y: 8 });
  writeLegendPosition(storage, { x: 40, y: 18 });
  assert.equal(memory.has(DRAWING_PANEL_STORAGE_KEY), true);
  assert.deepEqual(readLegendPosition(storage), { x: 40, y: 18 });
  memory.set(DRAWING_PANEL_STORAGE_KEY, '{');
  assert.deepEqual(readLegendPosition(storage), { x: 8, y: 8 });
});
