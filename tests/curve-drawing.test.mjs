import test from 'node:test';
import assert from 'node:assert/strict';
import { arcPoints, bezierPoints, CURVE_POINTS, curveFigures, curveSettings, registerCurveOverlays } from '../src/curve-drawing.js';
import { DRAWING_TOOLS } from '../src/drawing-catalog.js';
import { drawingPatch } from '../src/drawing-editor.js';
import { chartDateTimeInput } from '../src/chart-time.js';
import { SharedCharts } from '../server/shared-charts.mjs';

const point = (timestamp, value) => ({timestamp, value});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('curve tools are offered in the shapes group with fixed anchor counts', () => {
  const definitions = [];
  registerCurveOverlays(item => definitions.push(item));
  for (const [name, count] of Object.entries(CURVE_POINTS)) {
    assert.equal(DRAWING_TOOLS.find(tool => tool.name === name).group, 'shapes');
    assert.equal(definitions.find(item => item.name === name).totalStep, count + 1);
  }
});

test('bezier curves start and end on the end anchors and bend toward the controls', () => {
  const quad = bezierPoints([{x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 80}], 4);
  assert.deepEqual(quad[0], {x: 0, y: 0});
  assert.deepEqual(quad.at(-1), {x: 100, y: 0});
  assert.deepEqual(quad[2], {x: 50, y: 40});
  const cubic = bezierPoints([{x: 0, y: 0}, {x: 90, y: 0}, {x: 30, y: 60}, {x: 60, y: -60}], 2);
  assert.deepEqual(cubic[1], {x: 45, y: 0});
  assert.ok(bezierPoints([{x: 0, y: 0}, {x: 90, y: 0}, {x: 30, y: 60}, {x: 60, y: -60}], 4)[1].y > 0);
});

test('arc passes through all three anchors on the side of the middle anchor', () => {
  for (const mid of [{x: 50, y: -50}, {x: 50, y: 50}, {x: 20, y: -40}]) {
    const arc = arcPoints({x: 0, y: 0}, {x: 100, y: 0}, mid, 256);
    close(arc[0].x, 0); close(arc[0].y, 0);
    close(arc.at(-1).x, 100); close(arc.at(-1).y, 0);
    assert.ok(arc.some(item => Math.hypot(item.x - mid.x, item.y - mid.y) < 2));
    assert.ok(arc.every(item => Math.sign(item.y) === Math.sign(mid.y) || Math.abs(item.y) < 1e-9));
  }
  assert.deepEqual(arcPoints({x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 0}), [{x: 0, y: 0}, {x: 100, y: 0}]);
});

test('fill defaults to on for arcs and off for curves, and only a fill figure is added when enabled', () => {
  assert.deepEqual(curveSettings(undefined, 'localArc'), {fill: true});
  assert.deepEqual(curveSettings(undefined, 'localCurve'), {fill: false});
  assert.deepEqual(curveSettings({}, 'localArc'), {fill: true});
  assert.throws(() => curveSettings({closed: true}, 'localCurve'), /曲线参数/);
  assert.throws(() => curveSettings({fill: 'yes'}, 'localCurve'), /填充/);
  const coordinates = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 50, y: 60}];
  const filled = curveFigures({coordinates, overlay: {name: 'localArc', extendData: {fill: true}}});
  assert.deepEqual(filled.map(item => item.type), ['polygon', 'line']);
  const plain = curveFigures({coordinates, overlay: {name: 'localCurve', extendData: {fill: false}, styles: {line: {color: '#f23645', size: 2, style: 'dashed'}}}});
  assert.deepEqual(plain.map(item => item.type), ['line']);
  assert.deepEqual(plain[0].styles, {color: '#f23645', size: 2, style: 'dashed'});
  const drafting = curveFigures({coordinates, overlay: {name: 'localCurve', isDrawing: () => true}});
  assert.equal(drafting.filter(item => item.styles.style === 'dashed').length, 2);
  assert.equal(curveFigures({coordinates: coordinates.slice(0, 1), overlay: {name: 'localArc'}}).length, 0);
});

test('shared charts require the exact anchor count and only a fill setting', () => {
  const chart = new SharedCharts(':memory:');
  const apply = (drawing, revision, batch) => chart.apply('main', {baseRevision: revision, batchId: batch, actor: {id: 'user', name: 'Tester'}, operations: [{type: 'upsert_drawing', key: 'BTCUSDT|1d', drawing}]}, {role: 'editor', kind: 'human'});
  const points = [point(1, 10), point(2, 12), point(3, 9), point(4, 11)];
  try {
    const arc = apply({id: 'arc', name: 'localArc', points: points.slice(0, 3)}, 0, 'arc');
    assert.deepEqual(arc.state.drawings['BTCUSDT|1d'][0].extendData, {fill: true});
    const curve = apply({id: 'double', name: 'localDoubleCurve', points, extendData: {fill: true}}, 1, 'double');
    assert.deepEqual(curve.state.drawings['BTCUSDT|1d'].find(item => item.id === 'double').extendData, {fill: true});
    assert.throws(() => apply({id: 'short', name: 'localCurve', points: points.slice(0, 2)}, 2, 'short'), /3 个锚点/);
    assert.throws(() => apply({id: 'long', name: 'localArc', points}, 2, 'long'), /3 个锚点/);
    assert.throws(() => apply({id: 'extra', name: 'localCurve', points: points.slice(0, 3), extendData: {closed: true}}, 2, 'extra'), /曲线参数/);
  } finally { chart.close(); }
});

test('curve editor toggles fill and keeps untouched anchors', () => {
  const original = {name: 'localCurve', points: [point(1, 10), point(2, 12), point(3, 9)], styles: {line: {color: '#2962ff', size: 1, style: 'solid'}}, extendData: {fill: false}, lock: false};
  const values = {color: '#2962ff', width: 1, lineStyle: 'solid', textSize: 11, lock: false, fill: true, points: original.points.map(item => ({price: String(item.value), time: chartDateTimeInput(item.timestamp, 'UTC')}))};
  const patch = drawingPatch(original, values, 'UTC');
  assert.deepEqual(patch.points, original.points);
  assert.deepEqual(patch.extendData, {fill: true});
  assert.deepEqual(drawingPatch({...original, name: 'localArc', extendData: undefined}, {...values, fill: undefined}, 'UTC').extendData, {fill: true});
});
