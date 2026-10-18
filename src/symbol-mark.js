import {SYMBOL_LOGOS,SYMBOL_IDENTITIES} from './symbol-logo-catalog.js';
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
  let body=String(symbol||'').trim().toUpperCase().replace(/^CSV:/,'').split('|')[0];
  if(/^\d{1,5}\.HK$/.test(body))body=`${Number(body.split('.')[0]).toString().padStart(4,'0')}.HK`;
  body=body.replace(/^(?:SH|SSE|SHSE):?(\d{6})$/,'$1.SS').replace(/^(?:SZ|SZSE):?(\d{6})$/,'$1.SZ');
  if(!SYMBOL_IDENTITIES[body])body=body.replace(/^(NASDAQ|NYSE|AMEX|ARCA):/,'');
  return body;
}

function cryptoBase(body){
  const identity=SYMBOL_IDENTITIES[body];
  if(['us-binance','binance-perp'].includes(identity?.market)||identity?.type==='stock-token')return '';
  if(identity?.market==='crypto'&&identity.baseAsset)return identity.baseAsset;
  const code=body.replace(/^(OKX|KRAKEN|BINANCE|BINANCE-SPOT|COINBASE):/,'');
  const pair=code.match(/^([A-Z0-9]{1,15})[-/](?:USDT|USDC|USD|EUR|JPY|GBP|BTC|ETH|SOL)$/)||code.match(/^([A-Z0-9]{2,15}?)(?:FDUSD|USDT|USDC|USD1|USD)$/);
  return pair?.[1]||'';
}

export function symbolLetters(symbol) {
  const body = tickerBody(symbol).toUpperCase();
  const base=cryptoBase(body);
  if(base)return cryptoGlyph[base]||base.slice(0,1);
  const head=body.replace(/^\^/,'').split(/[.=]/)[0].replace(/[^A-Z0-9]/g,'');
  return head.slice(0,1)||'?';
}

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const currencyColors={USD:'#4275b9',EUR:'#3558ad',GBP:'#9b4266',JPY:'#d65266',AUD:'#c89332',NZD:'#48678b',CNY:'#c64b46',CNH:'#c64b46',CHF:'#d35252',CAD:'#bb4f56',SGD:'#b84e62'};
const currencyGlyph={USD:'$',EUR:'€',GBP:'£',JPY:'¥',AUD:'A',NZD:'N',CNY:'¥',CNH:'¥',CHF:'+',CAD:'C',SGD:'S'};
function forexMark(body){
  const raw=body.slice(0,-2),pair=raw.length===3?['USD',raw]:[raw.slice(0,3),raw.slice(3)];
  return `<svg class="symbol-mark currency-pair" viewBox="0 0 20 20" aria-hidden="true">${pair.map((code,i)=>`<circle cx="${i?12.7:7}" cy="${i?12.7:7}" r="6.1" fill="${currencyColors[code]||'#52717c'}" stroke="var(--surface,#10151e)" stroke-width="1"/><text x="${i?12.7:7}" y="${i?13:7.3}" text-anchor="middle" dominant-baseline="middle" fill="#fff" stroke="none" font-size="8" font-family="sans-serif">${esc(currencyGlyph[code]||code[0])}</text>`).join('')}</svg>`;
}
const futureGroups=[
  [/黄金|Gold/, 'metal','Au','#a88028'],[/白银|Silver/,'metal','Ag','#768897'],[/铜|Copper/,'metal','Cu','#a76445'],[/铝/,'metal','Al','#5c889e'],[/铂金/,'metal','Pt','#6c8c90'],[/钯金/,'metal','Pd','#7074a1'],[/碳酸锂/,'metal','Li','#6a8e81'],[/铁矿|螺纹/,'metal','Fe','#677b8a'],
  [/天然气/,'gas','NG','#567baf'],[/原油|取暖油|汽油|PTA/,'oil','油','#566884'],[/豆|棕榈/,'leaf','豆','#568468'],[/玉米|小麦/,'grain','谷','#a58a42'],[/白糖|原糖/,'sugar','糖','#698ca4'],[/棉花/,'cotton','棉','#9b839c'],[/咖啡|可可/,'bean','豆','#9c7057'],[/活牛|瘦肉猪/,'livestock','畜','#a37569'],[/国债/,'bond','债','#677da5'],[/指数|E-mini|股指/,'index','指','#7369aa'],
];
const futureShapes={metal:'<path d="m4 9 2-4h8l2 4-2 2H6zM6 5l1 4h8M4 9h12"/>',oil:'<path d="M10 3c-1 3-5 5-5 8a5 5 0 0 0 10 0c0-3-4-5-5-8z"/>',gas:'<path d="M10 3c3 3 5 5 5 8a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 2-2 1-4 1-7z"/>',leaf:'<path d="M5 13C4 5 12 4 16 4c0 7-4 11-11 9zm0 2 7-7"/>',grain:'<path d="M10 3v13M10 7 6 4v4l4 3 4-3V4zM10 12 6 9v4l4 3 4-3V9"/>',sugar:'<path d="m5 7 5-3 5 3v6l-5 3-5-3zm0 0 5 3 5-3M10 10v6"/>',cotton:'<path d="M6 13a4 4 0 0 1-1-8 4 4 0 0 1 8 0 4 4 0 0 1 1 8zM7 14l3 3 3-3"/>',bean:'<ellipse cx="10" cy="9" rx="5" ry="7" transform="rotate(35 10 9)"/><path d="M13 3c-6 3 1 8-6 12"/>',bond:'<path d="M5 3h7l3 3v11H5zM8 7h4M8 10h4M8 13h3"/>',index:'<path d="M4 4v12h13M6 12l3-4 3 2 4-6"/>',livestock:'<path d="M5 7 3 4M15 7l2-3M5 6h10v8l-3 3H8l-3-3zM8 10h.1M12 10h.1M8 14h4"/>'};
function futureMark(body,name){
  const [,kind,label,color]=futureGroups.find(([pattern])=>pattern.test(name))||[null,'index',body.replace(/^.*:/,'').replace(/=F$/,'').slice(0,2),'#647e93'];
  return `<svg class="symbol-mark commodity-mark" viewBox="0 0 20 20" aria-hidden="true"><rect x=".5" y=".5" width="19" height="19" rx="5" fill="${color}" stroke="none"/><g fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round" opacity=".3">${futureShapes[kind]}</g><text x="10" y="11" text-anchor="middle" dominant-baseline="middle" fill="#fff" stroke="none" font-size="${label.length>2?7:9}" font-weight="600" font-family="sans-serif">${esc(label)}</text></svg>`;
}
function letterMark(symbol){
  const body=tickerBody(symbol),identity=SYMBOL_IDENTITIES[body];
  if(/^[A-Z]{3}(?:[A-Z]{3})?=X$/.test(body))return forexMark(body);
  if(body==='PYTH:XAUUSD')return futureMark(body,'Gold 黄金');
  if(body==='BINANCE:XAUUSDT')return futureMark(body,'Gold 黄金');
  if(body==='BINANCE:XAGUSDT')return futureMark(body,'Silver 白银');
  if(identity?.type==='futures'||/^(?:SINA:|[A-Z0-9]{1,5}=F$)/.test(body))return futureMark(body,identity?.name||body);
  const base=cryptoBase(body),raw=(identity?.underlyingSymbol||body.replace(/^.*:/,'')).replace(/^\^/,'').split(/[.=]/)[0];
  const label=base?(cryptoGlyph[base]||base.replace(/^(?:1000000|100000|1000)(?=[A-Z])/,'').slice(0,4)):identity?.type==='index'?raw.slice(-3):/^\d/.test(raw)?raw.slice(-2):raw.slice(0,2)||symbolLetters(symbol);
  let hash=0;for(const char of body)hash=(hash*31+char.charCodeAt(0))>>>0;
  const hue=hash%360,bg=`hsl(${hue} 38% 36%)`;
  return `<svg class="symbol-mark generated-mark" viewBox="0 0 20 20" aria-hidden="true"><${base?'circle cx="10" cy="10" r="9.5"':'rect x=".5" y=".5" width="19" height="19" rx="5"'} fill="${bg}" stroke="none"/><text x="10" y="10.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" stroke="none" font-size="${label.length>2?7:9}" font-weight="600" font-family="sans-serif">${esc(label)}</text></svg>`;
}

function logoSrc(symbol) {
  const body = tickerBody(symbol).toUpperCase();
  if(/^[A-Z]{3}(?:[A-Z]{3})?=X$/.test(body))return '';
  const base=cryptoBase(body);
  const local=(base&&localLogos[`${base}USDT`])||SYMBOL_LOGOS[body]||(base&&SYMBOL_LOGOS[`${base}USDT`])||localLogos[body]||'';
  return local ? `/src/assets/logos/${local}` : '';
}

/** image = a checked-in local file; monogram = the generated mark used for every other product. */
export function iconKind(symbol) {
  return logoSrc(symbol) ? 'image' : 'monogram';
}

export function symbolMark(symbol) {
  const letter = letterMark(symbol);
  const src = logoSrc(symbol);
  if (!src) return letter;
  return `<span class="symbol-logo">${letter}<img src="${src}" alt="" width="20" height="20" draggable="false" decoding="async"></span>`;
}

export function activateSymbolMarks(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.symbol-logo img').forEach(img => {
    const drop = () => img.remove();
    img.addEventListener('error', drop);
    if (img.complete && img.naturalWidth === 0) drop();
  });
}
