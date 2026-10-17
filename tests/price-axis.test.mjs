import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPriceRange, wheelScale } from '../src/price-axis.js';

test('wheel up shrinks the price range around its midpoint and wheel down expands it', () => {
  const range = { from: 100, to: 200, range: 100, realFrom: 100, realTo: 200, realRange: 100 };
  const zoomIn = nextPriceRange(range, wheelScale({ deltaX: 0, deltaY: -100, deltaMode: 0 }));
  const zoomOut = nextPriceRange(range, wheelScale({ deltaX: 0, deltaY: 100, deltaMode: 0 }));
  assert.ok(zoomIn.range < range.range);
  assert.ok(zoomOut.range > range.range);
  assert.ok(Math.abs((zoomIn.from + zoomIn.to) / 2 - 150) < 1e-9);
  assert.equal(zoomIn.realRange, zoomIn.realTo - zoomIn.realFrom);
});

test('a horizontal wheel is left to the time axis', () => {
  assert.equal(wheelScale({ deltaX: 40, deltaY: 5, deltaMode: 0 }), 0);
  assert.equal(nextPriceRange({ from: 1, to: 2, range: 1 }, 0), null);
});
