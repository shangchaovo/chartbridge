// Motion stays on interface surfaces; chart geometry never participates.
export function createUIMotion() {
  const document = globalThis.document;
  const preference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const prices = new Map();
  const priceKeys = new WeakMap();
  const revealKeys = new WeakMap();
  const animations = new WeakMap();
  const active = new Set();
  const maxPrices = 300;
  let destroyed = false;

  const cancel = element => {
    const animation = animations.get(element);
    if (!animation) return;
    active.delete(animation);
    animations.delete(element);
    animation.cancel();
  };

  const cancelAll = () => {
    for (const animation of active) animation.cancel();
    active.clear();
  };

  const motionAllowed = element => !destroyed
    && !preference?.matches
    && !document?.hidden
    && element?.isConnected
    && typeof element.animate === 'function';

  const animate = (element, keyframes, options) => {
    cancel(element);
    const animation = element.animate(keyframes, options);
    animations.set(element, animation);
    active.add(animation);
    const clean = () => {
      active.delete(animation);
      if (animations.get(element) === animation) animations.delete(element);
    };
    // Cancellation rejects finished; handle both outcomes without leaking promises.
    animation.finished.then(clean, clean);
  };

  const rememberPrice = (key, value) => {
    prices.delete(key);
    prices.set(key, value);
    if (prices.size > maxPrices) prices.delete(prices.keys().next().value);
  };

  const preferenceChanged = () => {
    if (preference.matches) cancelAll();
  };
  const visibilityChanged = () => {
    if (document.hidden) cancelAll();
  };
  preference?.addEventListener?.('change', preferenceChanged);
  document?.addEventListener('visibilitychange', visibilityChanged);

  return {
    price(element, value, key) {
      if (destroyed || !element || key == null) return;
      const previousKey = priceKeys.get(element);
      const switched = previousKey !== undefined && previousKey !== key;
      priceKeys.set(element, key);

      if (!Number.isFinite(value)) {
        prices.delete(key);
        cancel(element);
        return;
      }

      const previous = prices.get(key);
      rememberPrice(key, value);
      if (switched || !motionAllowed(element)) {
        cancel(element);
        return;
      }
      if (previous === undefined || previous === value) return;

      const color = value > previous ? '8, 153, 129' : '242, 54, 69';
      animate(element, [
        { backgroundColor: `rgba(${color}, 0.24)` },
        { backgroundColor: `rgba(${color}, 0)` },
      ], { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    },

    reveal(element, key) {
      if (destroyed || !element || key == null) return;
      const previous = revealKeys.get(element);
      revealKeys.set(element, key);
      if (previous === undefined || previous === key) return;
      cancel(element);
      if (!motionAllowed(element) || !element.getClientRects().length) return;
      if (globalThis.getComputedStyle(element).visibility !== 'visible') return;
      animate(element, [{ opacity: 0 }, { opacity: 1 }], {
        duration: 180,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAll();
      prices.clear();
      preference?.removeEventListener?.('change', preferenceChanged);
      document?.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
