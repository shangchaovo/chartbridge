import test from 'node:test';
import assert from 'node:assert/strict';
import { replayDelay, replayStartCount, stepReplayCount } from '../src/replay.js';

test('bar replay hides the future, steps one bar, and speeds up playback', () => {
  assert.equal(replayStartCount(0, 10), 2);
  assert.equal(replayStartCount(4, 10), 5);
  assert.equal(replayStartCount(9, 10), 10);
  assert.equal(replayStartCount(1.5, 10), null);
  assert.equal(stepReplayCount(5, 10, 1), 6);
  assert.equal(stepReplayCount(5, 10, -1), 4);
  assert.equal(stepReplayCount(2, 10, -1), 2);
  assert.equal(stepReplayCount(10, 10, 1), 10);
  assert.equal(replayDelay(1), 650);
  assert.equal(replayDelay(4), 163);
  assert.equal(replayDelay(3), 650);
});
