import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SYMBOL_CATALOG} from '../server/market-data.mjs';
import {FUTURES_CATALOG} from '../server/public-feeds.mjs';
import {SYMBOL_LOGOS,SYMBOL_IDENTITIES} from '../src/symbol-logo-catalog.js';
import {symbolMark,symbolLetters,activateSymbolMarks} from '../src/symbol-mark.js';

test('all catalog symbols have readable local identity and real logo assets exist',async()=>{
 const symbols=[...SYMBOL_CATALOG,...FUTURES_CATALOG],files=new Set();
 for(const row of symbols){
  const markup=symbolMark(row.symbol);assert.match(markup,/<svg\b/,row.symbol);assert.doesNotMatch(markup,/>\?<\/text>|https?:|undefined|NaN/,row.symbol);
  const src=markup.match(/<img src="([^"]+)"/)?.[1];if(src){assert.match(src,/^\/src\/assets\/logos\/[a-z0-9.-]+$/);files.add(src);}
 }
 assert.ok(files.size>180);
 for(const file of files){const body=await readFile(new URL(`..${file}`,import.meta.url));assert.ok(body.length>30,file);if(file.endsWith('.svg'))assert.match(body.toString(),/<svg\b/);}
 for(const row of symbols.filter(x=>x.type==='stock'))assert.match(symbolMark(row.symbol),/<img/,row.symbol);
});

test('provider aliases share identities while exchange-specific stock codes remain distinct',()=>{
 for(const code of ['BTCUSDC','BTCFDUSD','BINANCE:BTCUSDT','OKX:BTC-USDT','KRAKEN:BTC/USD'])assert.match(symbolMark(code),/btc\.svg/,code);
 assert.equal(symbolMark('0700.HK'),symbolMark('00700.HK'));assert.equal(symbolMark('600519.SS'),symbolMark('SH600519'));
 assert.equal(symbolMark('AAPL'),symbolMark('NASDAQ:AAPL'));assert.equal(symbolLetters('^IXIC'),'I');
 assert.notEqual(symbolMark('000001.SS'),symbolMark('000001.SZ'));
 assert.match(symbolMark('BINANCE:TSLAUSDT'),new RegExp(SYMBOL_LOGOS['BINANCE:TSLAUSDT'].replaceAll('.','\\.')));
 assert.equal(symbolMark('BINANCE:TSLAUSDT').match(/<img src="([^"]+)"/)[1],symbolMark('TSLA').match(/<img src="([^"]+)"/)[1]);
 assert.match(symbolMark('EURJPY=X'),/currency-pair/);assert.match(symbolMark('GC=F'),/commodity-mark/);assert.match(symbolMark('SINA:AU0'),/>Au<\/text>/);
 assert.match(symbolMark('^UNKNOWN'),/generated-mark/);assert.doesNotMatch(symbolMark('<script>alert(1)</script>'),/<script>/);
});

test('source records bind fetched SVG bytes to their provenance',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../src/assets/logos/sources.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.failures,[]);
 for(const asset of manifest.assets){const data=await readFile(new URL(`../src/assets/logos/${asset.file}`,import.meta.url));assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256);assert.match(asset.url,/^https:\/\/(?:s3-symbol-logo\.tradingview\.com|bin\.bnbstatic\.com)\//);}
});

test('imported and dynamically discovered symbols retain their company or base-asset identity',()=>{
 for(const symbol of Object.keys(SYMBOL_IDENTITIES))assert.doesNotMatch(symbolMark(symbol),/undefined|NaN|>\?<\/text>|https?:/,symbol);
 for(const symbol of ['BINANCE:SKHYNIXUSDT','TSLABUSDT','GOOGLBUSDT','DELLBUSDT','BINANCE-SPOT:TAOU','BINANCE:LTCUSD','COINBASE:BTCUSD','TONUSDT','QNTBUSDT','STXBUSDT','1000CATUSDT'])assert.match(symbolMark(symbol),/<img\b/,symbol);
 assert.match(symbolMark('BINANCE:BTCUSDT'),/btc\.svg/);assert.match(symbolMark('COINBASE:BTCUSD'),/btc\.svg/);
 assert.equal(SYMBOL_IDENTITIES.STXBUSDT.underlyingSymbol,'STX');
 assert.match(symbolMark('PYTH:XAUUSD'),/>Au<\/text>/);
 assert.match(symbolMark('BINANCE:XAUUSDT'),/>Au<\/text>/);
 assert.match(symbolMark('BINANCE:XAGUSDT'),/>Ag<\/text>/);
});

test('failed logos are removed and leave the existing SVG visible',()=>{
 const callbacks={},img={complete:false,naturalWidth:0,removed:false,addEventListener(type,callback){callbacks[type]=callback;},remove(){this.removed=true;}};
 activateSymbolMarks({querySelectorAll:()=>[img]});assert.equal(img.removed,false);callbacks.error();assert.equal(img.removed,true);
});
