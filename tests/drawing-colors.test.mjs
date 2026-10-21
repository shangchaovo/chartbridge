import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAWING_COLOR_STORAGE_KEY, readDrawingColors, rememberDrawingColor, drawingColorStyles, colorRgb, rgbColor, colorHsv, hsvColor} from '../src/drawing-colors.js';
import {drawingPatch} from '../src/drawing-editor.js';

const storage = () => {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
};
test('explicit color changes become the next default and survive a fresh preference load', () => {
  const saved = storage(), initial = readDrawingColors(saved);
  assert.deepEqual(initial, {color: null, recent: []});
  rememberDrawingColor(saved, initial, '#F23645');
  const reloaded = readDrawingColors(saved);
  assert.equal(reloaded.color, '#f23645');
  const next = rememberDrawingColor(saved, reloaded, '#089981');
  assert.deepEqual(next, {color: '#089981', recent: ['#089981', '#f23645']});
  assert.deepEqual(readDrawingColors(saved), next);
  assert.deepEqual(initial, {color: null, recent: []});
});
test('recent colors are unique, ordered by use and capped at ten', () => {
  const saved = storage(); let preferences = readDrawingColors(saved);
  for (let index = 0; index < 14; index++) preferences = rememberDrawingColor(saved, preferences, `#0000${index.toString(16).padStart(2, '0')}`);
  preferences = rememberDrawingColor(saved, preferences, '#00000b');
  assert.equal(preferences.recent.length, 10);
  assert.equal(preferences.recent[0], '#00000b');
  assert.equal(preferences.recent.filter(value => value === '#00000b').length, 1);
  assert.equal(preferences.recent.includes('#000000'), false);
});
test('broken, invalid and unavailable storage recover without breaking drawing', () => {
  const saved = storage();
  for (const value of ['{', 'null', '[]', '{"color":"red","recent":[null,"#089981","bad","#089981"]}']) {
    saved.setItem(DRAWING_COLOR_STORAGE_KEY, value);
    assert.equal(readDrawingColors(saved).color, null);
  }
  assert.deepEqual(readDrawingColors(saved).recent, ['#089981']);
  const unavailable = {getItem() {throw Error('blocked');}, setItem() {throw Error('full');}};
  assert.deepEqual(readDrawingColors(unavailable), {color: null, recent: []});
  assert.equal(rememberDrawingColor(unavailable, null, '#f23645').color, '#f23645');
  assert.deepEqual(rememberDrawingColor(saved, {color: '#089981'}, 'invalid'), {color: '#089981', recent: []});
});
test('color applies to outlines, fills and text while preserving width and unrelated figure settings', () => {
  const original = {line: {color: '#2962ff', size: 14, style: 'dashed'}, rect: {style: 'stroke_fill', borderSize: 3}, text: {size: 19}, point: {color: '#fff'}};
  const styles = drawingColorStyles('#089981', original);
  assert.deepEqual(styles.line, {color: '#089981', size: 14, style: 'dashed'});
  for (const figure of ['rect', 'circle', 'polygon', 'arc']) {
    assert.equal(styles[figure].borderColor, '#089981');
    assert.equal(styles[figure].color, '#0899811f');
  }
  assert.equal(styles.rect.borderSize, 3); assert.equal(styles.rect.style, 'stroke_fill');
  assert.equal(styles.text.size, 19); assert.deepEqual(styles.point, original.point);
  assert.equal(original.line.color, '#2962ff');
  styles.point.color = '#000'; assert.equal(original.point.color, '#fff');
});
test('RGB and HSV inputs round-trip preset and arbitrary colors without drifting', () => {
  for (const color of ['#f23645', '#089981', '#2962ff', '#000000', '#ffffff', '#787b86', '#0102fe', '#12ab34']) {
    assert.equal(rgbColor(colorRgb(color)), color);
    assert.equal(hsvColor(colorHsv(color)), color);
  }
  assert.equal(rgbColor([256, 0, 0]), null);
  assert.equal(rgbColor([0, NaN, 0]), null);
  assert.equal(rgbColor([1, 2]), null);
  assert.equal(rgbColor([1.5, 2, 3]), null);
});
test('settings color changes update rectangle fill and outline together without moving anchors', () => {
  const original = {name: 'rect', points: [{timestamp: 1000, value: 100}, {timestamp: 2000, value: 120}], styles: {line: {color: '#2962ff', size: 1}}, lock: false};
  const result = drawingPatch(original, {color: '#f23645', width: 3, lineStyle: 'solid', textSize: 11}, 'UTC');
  assert.deepEqual(result.points, original.points);
  assert.equal(result.styles.rect.color, '#f236451f');
  assert.equal(result.styles.rect.borderSize, 3);
  assert.equal(original.styles.rect, undefined);
});
