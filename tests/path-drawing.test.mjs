import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizePathPoints, MAX_PATH_POINTS, pathFigures, pathSettings, registerPathOverlays } from '../src/path-drawing.js';
import { drawingPatch } from '../src/drawing-editor.js';
import { chartDateTimeInput } from '../src/chart-time.js';
import { patchKLineCharts } from '../scripts/patch-klinecharts.mjs';
import { SharedCharts } from '../server/shared-charts.mjs';

const point = (timestamp, value) => ({timestamp, value});

test('path points drop the preview, duplicates and a snapped closing vertex', () => {
  assert.equal(finalizePathPoints([point(1, 10), {value: 11}]), null);
  assert.deepEqual(finalizePathPoints([point(1, 10), point(1, 10), point(2, 12), undefined]).points.map(item => item.value), [10, 12]);
  const closed = finalizePathPoints([point(1, 10), point(2, 12), point(3, 9), point(4, 8)], {dropLast: true, closed: true});
  assert.equal(closed.closed, true);
  assert.deepEqual(closed.points.map(item => item.timestamp), [1, 2, 3]);
  const snapped = finalizePathPoints([point(1, 10), point(2, 12), point(3, 9), point(1, 10)], {dropLast: true, closed: true});
  assert.equal(snapped.closed, true);
  assert.equal(snapped.points.length, 3);
  assert.equal(finalizePathPoints([point(1, 10), point(2, 12)], {closed: true}).closed, false);
  const capped = finalizePathPoints(Array.from({length: 80}, (_, index) => point(index + 1, index + 1)));
  assert.equal(capped.points.length, MAX_PATH_POINTS);
});

test('polyline fill is optional and only a closed finished shape uses a polygon', () => {
  const definitions = [];
  registerPathOverlays(item => definitions.push(item), {toPixel: point => ({x: point.timestamp, y: point.value})});
  const [path, polyline] = definitions;
  assert.equal(path.totalStep, MAX_PATH_POINTS + 1);
  const coordinates = [{x: 0, y: 0}, {x: 10, y: 4}, {x: 6, y: 12}];
  assert.equal(pathFigures({coordinates, overlay: {name: 'localPath', styles: {line: {color: '#2962ff', size: 2, style: 'dashed'}}}})[0].type, 'line');
  const open = pathFigures({coordinates, overlay: {name: 'localPolyline', extendData: {closed: false, fill: true}, isDrawing: () => false}});
  assert.equal(open[0].type, 'line');
  const filled = pathFigures({coordinates, overlay: {name: 'localPolyline', extendData: {closed: true, fill: true}, styles: {line: {color: '#2962ff', size: 2}}, isDrawing: () => false}})[0];
  assert.equal(filled.type, 'polygon');
  assert.equal(filled.styles.style, 'stroke_fill');
  assert.equal(filled.styles.color, '#2962ff24');
  const drawing = polyline.onDrawing;
  const overlay = {name: 'localPolyline', currentStep: 4, totalStep: polyline.totalStep, points: [point(0, 0), point(10, 4), point(6, 12), point(1, 1)], extendData: {fill: false}};
  drawing({overlay});
  assert.equal(overlay._pathSnap, true);
  assert.equal(overlay.extendData.closed, true);
  assert.equal(overlay.extendData.fill, false);
  assert.equal(overlay.currentStep, polyline.totalStep - 1);
});

test('path settings and shared charts accept an open path and a closed polyline only', () => {
  assert.deepEqual(pathSettings(undefined), {closed: false, fill: true});
  assert.throws(() => pathSettings('closed'), /折线参数/);
  const chart = new SharedCharts(':memory:');
  const apply = (drawing, revision, batch) => chart.apply('main', {baseRevision: revision, batchId: batch, actor: {id: 'user', name: 'Tester'}, operations: [{type: 'upsert_drawing', key: 'BTCUSDT|1d', drawing}]}, {role: 'editor', kind: 'human'});
  const points = [point(1, 10), point(2, 12), point(3, 9)];
  try {
    const path = apply({id: 'path', name: 'localPath', points: points.slice(0, 2)}, 0, 'path');
    assert.equal(path.state.drawings['BTCUSDT|1d'][0].extendData, undefined);
    const line = apply({id: 'poly', name: 'localPolyline', points, extendData: {closed: true, fill: false}}, 1, 'poly');
    assert.deepEqual(line.state.drawings['BTCUSDT|1d'].find(item => item.id === 'poly').extendData, {closed: true, fill: false});
    assert.throws(() => apply({id: 'short', name: 'localPath', points: [point(1, 10)]}, 2, 'short'), /锚点/);
    assert.throws(() => apply({id: 'extra', name: 'localPath', points: points.slice(0, 2), extendData: {closed: true}}, 2, 'extra'), /附加参数/);
    assert.throws(() => apply({id: 'two', name: 'localPolyline', points: points.slice(0, 2), extendData: {closed: true}}, 2, 'two'), /3 个锚点/);
    assert.throws(() => apply({id: 'many', name: 'localPath', points: Array.from({length: MAX_PATH_POINTS + 1}, (_, index) => point(index + 1, index + 1))}, 2, 'many'), /锚点/);
  } finally { chart.close(); }
});

test('polyline editor can close or open the shape without changing untouched anchors', () => {
  const original = {name: 'localPolyline', points: [point(1, 10), point(2, 12), point(3, 9)], styles: {line: {color: '#2962ff', size: 1, style: 'solid'}}, extendData: {closed: false, fill: true}, lock: false};
  const values = {color: '#2962ff', width: 1, lineStyle: 'solid', textSize: 11, lock: false, closed: true, fill: false, points: original.points.map(item => ({price: String(item.value), time: chartDateTimeInput(item.timestamp, 'UTC')}))};
  const closed = drawingPatch(original, values, 'UTC');
  assert.deepEqual(closed.points, original.points);
  assert.deepEqual(closed.extendData, {closed: true, fill: false});
  assert.throws(() => drawingPatch({...original, points: original.points.slice(0, 2)}, {...values, points: values.points.slice(0, 2)}, 'UTC'), /3 个锚点/);
});

test('chart patch finishes path double-clicks and loaded anchors, while fixed tools still place an anchor', () => {
  const source = readFileSync(new URL('../node_modules/klinecharts/dist/index.esm.js', import.meta.url), 'utf8');
  const patched = patchKLineCharts(source);
  assert.match(patched, /overlay\.name === 'localPath' \|\| overlay\.name === 'localPolyline'/);
  assert.match(patched, /overlay\.points\.length = Math\.max\(0, overlay\.currentStep - 1\)/);
  assert.match(patched, /this\.name === 'localPath' \|\| this\.name === 'localPolyline'/);
  assert.match(patched, /mouseDoubleClickEvent : this\._handler\.mouseClickEvent/);
  assert.equal(patched.includes('progressInstancePaneId === paneId) {\n                    overlay.forceComplete();'), false);
});
