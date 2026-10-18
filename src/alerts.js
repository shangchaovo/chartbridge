// A price alert fires when the latest price reaches the level from either side.
// The previous price must sit strictly on one side, and the current price must
// touch or pass the level. A price that is already on the level — including the
// first quote observed after the alert exists — does not fire. It has to leave
// and come back. Legacy above/below/crossing directions are the same reach rule.

export const PRICE_REACH = 'reach';

const REACH_DIRECTIONS = new Set([
  PRICE_REACH,
  'above',
  'below',
  'crossing',
  'crossingUp',
  'crossingDown',
  'cross',
  'crossUp',
  'crossDown',
]);

export function isReachDirection(direction) {
  return direction == null || direction === '' || REACH_DIRECTIONS.has(direction);
}

export function normalizePriceAlert(alert) {
  if (!alert || typeof alert !== 'object' || !isReachDirection(alert.direction)) return alert;
  return { ...alert, direction: PRICE_REACH };
}

export function priceReached(previousPrice, price, target) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(price) || !Number.isFinite(target) || target <= 0) return false;
  const fromBelow = previousPrice < target && price >= target;
  const fromAbove = previousPrice > target && price <= target;
  return fromBelow || fromAbove;
}

export function evaluateAlerts(alerts, quote, previousPrice) {
  if (!Array.isArray(alerts) || !quote || typeof quote.symbol !== 'string' || !Number.isFinite(quote.price) || !Number.isFinite(previousPrice)) return [];
  const hits = [];
  for (const alert of alerts) {
    if (!alert || alert.firedAt || alert.paused || alert.symbol !== quote.symbol) continue;
    if (!isReachDirection(alert.direction) || !Number.isFinite(alert.price) || alert.price <= 0) continue;
    if (priceReached(previousPrice, quote.price, alert.price)) hits.push(alert);
  }
  return hits;
}

export function alertStatus(alert) {
  if (alert?.firedAt) return 'fired';
  if (alert?.paused) return 'paused';
  return 'active';
}
