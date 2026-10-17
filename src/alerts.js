export function evaluateAlerts(alerts, quote) {
  if (!Array.isArray(alerts) || !quote || typeof quote.symbol !== 'string' || !Number.isFinite(quote.price)) return [];
  const hits = [];
  for (const alert of alerts) {
    if (!alert || alert.firedAt || alert.symbol !== quote.symbol) continue;
    if ((alert.direction !== 'above' && alert.direction !== 'below') || !Number.isFinite(alert.price) || alert.price <= 0) continue;
    const hit = alert.direction === 'above' ? quote.price >= alert.price : quote.price <= alert.price;
    if (hit) hits.push(alert);
  }
  return hits;
}
