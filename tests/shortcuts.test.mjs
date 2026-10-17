import assert from 'node:assert/strict';
import test from 'node:test';
import {matchShortcut, SHORTCUTS} from '../src/shortcuts.js';
import {DRAWING_TOOLS} from '../src/drawing-catalog.js';

const press = (key, extra = {}) => matchShortcut({key, target:{closest:()=>null}, ...extra});

test('drawing and chart shortcuts match TradingView keys', () => {
  assert.equal(press('t', {altKey:true}), 'trend');
  assert.equal(press('H', {altKey:true}), 'horizontal');
  assert.equal(press('c', {altKey:true}), 'cross');
  assert.equal(press('r', {altKey:true}), 'reset');
  assert.equal(press('R', {altKey:true, shiftKey:true}), 'rect');
  assert.equal(press('a', {altKey:true}), 'alert');
  assert.equal(press('t', {shiftKey:true}), 'lock-cursor');
  assert.equal(press('t', {altKey:true, shiftKey:true}), null);
  assert.equal(press('m', {altKey:true}), 'ruler');
  assert.equal(press('M', {altKey:true, shiftKey:true}), null);
  assert.equal(press('y', {altKey:true}), 'ray');
  assert.equal(press('e', {altKey:true}), 'extended');
  assert.equal(press('h', {altKey:true, shiftKey:true}), 'horizontal-ray');
  assert.equal(press('s', {altKey:true, shiftKey:true}), 'horizontal-segment');
  assert.equal(press('p', {altKey:true}), 'channel');
  assert.equal(press('w', {altKey:true}), 'price-channel');
  assert.equal(press('f', {altKey:true, shiftKey:true}), 'fib-extension');
  assert.equal(press('o', {altKey:true}), 'circle');
  assert.equal(press('o', {altKey:true, shiftKey:true}), 'triangle');
  assert.equal(press('a', {altKey:true, shiftKey:true}), 'arrow');
  assert.equal(press('k', {altKey:true}), 'price-line');
  assert.equal(press('k', {altKey:true, shiftKey:true}), 'price-tag');
  assert.equal(press('u', {altKey:true}), 'price-range');
  assert.equal(press('d', {altKey:true, shiftKey:true}), 'date-range');
  assert.equal(press('v', {altKey:true}), 'vertical');
  assert.equal(press('f', {altKey:true}), 'fib');
  assert.equal(press('n', {altKey:true}), 'note');
  assert.equal(press('l', {altKey:true}), 'lock');
  assert.equal(press('g', {altKey:true}), 'fit');
  assert.equal(press('h', {altKey:true, ctrlKey:true}), 'hide');
  assert.equal(press('i', {ctrlKey:true}), 'indicators');
  assert.equal(press('z', {metaKey:true}), 'undo');
  assert.equal(press('z', {ctrlKey:true, shiftKey:true}), 'redo');
  assert.equal(press('y', {ctrlKey:true}), 'redo');
  assert.equal(press('Delete'), 'delete');
  assert.equal(press('/'), 'search');
  assert.equal(press('ArrowLeft'), 'pan-left');
  assert.equal(press('+'), 'zoom-in');
  assert.equal(press(','), 'interval-prev');
  assert.equal(press('.'), 'interval-next');
});

test('typing and save stay out of each others way', () => {
  const field = {closest:selector => selector.includes('input') ? {} : null};
  assert.equal(matchShortcut({key:'t', altKey:true, target:field}), null);
  assert.equal(matchShortcut({key:'m', altKey:true, target:field}), null);
  assert.equal(matchShortcut({key:'h', altKey:true, shiftKey:true, target:field}), null);
  assert.equal(matchShortcut({key:'s', ctrlKey:true, target:field}), 'save');
  assert.equal(matchShortcut({key:'s', ctrlKey:true, altKey:true, target:{closest:()=>null}}), null);
  assert.equal(SHORTCUTS.find(item => item.id === 'pine').display.includes('Enter'), true);
  assert.equal(SHORTCUTS.find(item => item.id === 'reset').display, 'Alt+R');
  assert.equal(SHORTCUTS.find(item => item.id === 'alert').display, 'Alt+A');
  assert.equal(SHORTCUTS.find(item => item.id === 'lock-cursor').display, 'Shift+T');
  assert.equal(SHORTCUTS.find(item => item.id === 'rect').display, 'Alt+Shift+R');
  assert.equal(DRAWING_TOOLS.find(tool => tool.name === 'rect').shortcut, 'Alt+Shift+R');
  assert.equal(DRAWING_TOOLS.find(tool => tool.name === 'datePriceRange').shortcut, 'Alt+M');
  assert.equal(SHORTCUTS.find(item => item.id === 'ruler').display, 'Alt+M');
  const catalogShortcuts = {
    rayLine:'Alt+Y', straightLine:'Alt+E', horizontalRayLine:'Alt+Shift+H', horizontalSegment:'Alt+Shift+S',
    parallelStraightLine:'Alt+P', priceChannelLine:'Alt+W', fibExtension:'Alt+Shift+F', localCircle:'Alt+O',
    localTriangle:'Alt+Shift+O', arrowLine:'Alt+Shift+A', priceLine:'Alt+K', simpleTag:'Alt+Shift+K',
    priceRange:'Alt+U', dateRange:'Alt+Shift+D',
  };
  for (const [name, shortcut] of Object.entries(catalogShortcuts)) {
    assert.equal(DRAWING_TOOLS.find(tool => tool.name === name).shortcut, shortcut);
  }
});
