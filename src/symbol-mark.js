const cryptoGlyph = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', DOGE: 'Ð', XRP: '✕', BNB: '◆', ADA: '◈',
};

const localLogos = {
  BTCUSDT: 'btc.svg', ETHUSDT: 'eth.svg', SOLUSDT: 'sol.svg', BNBUSDT: 'bnb.svg',
  XRPUSDT: 'xrp.svg', DOGEUSDT: 'doge.svg', ADAUSDT: 'ada.svg',
  AAPL: 'aapl.png', NVDA: 'nvda.png', MSFT: 'msft.png', TSLA: 'tsla.png',
  AMZN: 'amzn.png', GOOGL: 'googl.png', META: 'meta.png',
  SPY: 'spy.png', QQQ: 'qqq.png',
  '0700.HK': '0700.hk.png', '9988.HK': '9988.hk.png', '3690.HK': '3690.hk.png',
  '1810.HK': '1810.hk.png', '9618.HK': '9618.hk.png', '0005.HK': '0005.hk.png',
  '600519.SS': '600519.ss.png', '000001.SZ': '000001.sz.png', '300750.SZ': '300750.sz.png',
  '601318.SS': '601318.ss.png', '600036.SS': '600036.ss.png',
  'EURUSD=X': 'eurusd.png', 'GBPUSD=X': 'gbpusd.png', 'JPY=X': 'usdjpy.png',
  'AUDUSD=X': 'audusd.png', 'CNY=X': 'usdcny.png', 'CHF=X': 'usdchf.png',
  '^GSPC': 'gspc.png', '^IXIC': 'ixic.png', '^DJI': 'dji.png', '^HSI': 'hsi.png',
  '000001.SS': 'ssec.png', '399001.SZ': 'szse.png',
};

function tickerBody(symbol) {
  return String(symbol || '').replace(/^CSV:/i, '').split('|')[0];
}

export function symbolLetters(symbol) {
  const body = tickerBody(symbol).toUpperCase();
  const crypto = body.match(/^([A-Z0-9]{2,12})(?:USDT|USDC|FDUSD)$/);
  if (crypto) return cryptoGlyph[crypto[1]] || crypto[1].slice(0, 1);
  const head = body.split(/[.=^]/)[0].replace(/[^A-Z0-9]/g, '');
  return (head.slice(0, head.length > 4 ? 1 : 1) || '?').slice(0, 1);
}

function letterMark(symbol) {
  const body = tickerBody(symbol).toUpperCase();
  const crypto = /^[A-Z0-9]{2,12}(?:USDT|USDC|FDUSD)$/.test(body);
  const label = symbolLetters(symbol);
  const safe = String(label).replace(/[&<>]/g, '');
  const shape = crypto
    ? '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1"/>'
    : '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.2" fill="none" stroke="currentColor" stroke-width="1"/>';
  return `<svg class="symbol-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${shape}<text x="8" y="8.2" text-anchor="middle" dominant-baseline="middle" fill="currentColor" font-size="${safe.length > 1 ? 7 : 8}" font-family="sans-serif">${safe}</text></svg>`;
}

function logoSrc(symbol) {
  const body = tickerBody(symbol).toUpperCase();
  const local = localLogos[body];
  return local ? `/src/assets/logos/${local}` : '';
}

export function symbolMark(symbol) {
  const letter = letterMark(symbol);
  const src = logoSrc(symbol);
  if (!src) return letter;
  return `<span class="symbol-logo">${letter}<img src="${src}" alt="" width="16" height="16" draggable="false"></span>`;
}

export function activateSymbolMarks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.symbol-logo img').forEach(img => {
    const drop = () => img.remove();
    img.addEventListener('error', drop);
    if (img.complete && img.naturalWidth === 0) drop();
  });
}
