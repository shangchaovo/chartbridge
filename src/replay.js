export const REPLAY_SPEEDS = Object.freeze([1, 2, 4, 8]);

export function replayDelay(speed) {
  const factor = REPLAY_SPEEDS.includes(speed) ? speed : 1;
  return Math.round(650 / factor);
}

/** TradingView starts replay on the clicked bar and hides every bar after it. */
export function replayStartCount(dataIndex, length) {
  if (!Number.isInteger(dataIndex) || dataIndex < 0 || !Number.isInteger(length) || length < 2) return null;
  return Math.min(length, Math.max(2, dataIndex + 1));
}

export function stepReplayCount(count, length, direction) {
  const next = Number(count) + direction;
  if (!Number.isInteger(length) || length < 2 || next < 2 || next > length) return count;
  return next;
}
