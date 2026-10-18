import test,{afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {fetchCandles,SYMBOL_CATALOG} from '../server/market-data.mjs';
import {pythFeed} from '../server/pyth-feed.mjs';
import {FREE_GOLD_SOURCES} from '../server/free-gold.mjs';
import {usStockLabel} from '../src/market-categories.js';
afterEach(()=>mock.restoreAll());

test('free gold sources retain contract versus token identities and stay outside US stock groups',()=>{
  for(const row of FREE_GOLD_SOURCES){
    assert.equal(usStockLabel(row),'');assert.ok(SYMBOL_CATALOG.some(item=>item.symbol===row.symbol));
  }
  assert.equal(FREE_GOLD_SOURCES[0].underlyingType,'COMMODITY');
  assert.equal(FREE_GOLD_SOURCES[1].type,'crypto');
});

test('gold perpetual and token candles use public Binance endpoints without Pyth or API keys',async()=>{
  const pyth=mock.method(pythFeed,'candles',()=>{throw Error('free sources must not use Pyth authorization');});
  const requests=[];
  mock.method(globalThis,'fetch',async(url,options)=>{
    const parsed=new URL(url);requests.push(parsed);
    assert.ok(!Object.keys(options?.headers||{}).some(key=>key.toLowerCase()==='authorization'));
    assert.ok(!Object.keys(options?.headers||{}).some(key=>key.toLowerCase()==='x-mbx-apikey'));
    return new Response(JSON.stringify(parsed.pathname.endsWith('/klines')?
      [[1792108800000,'4100','4200','4050','4150','10',1792195199999,'42000'],[1792195200000,'4150','4250','4100','4200','11',1792281599999,'45000']]:
      {lastPrice:'4200',priceChange:'50',priceChangePercent:'1.2',closeTime:1792281599999,volume:'11'}));
  });
  const contract=await fetchCandles({symbol:'BINANCE:XAUUSDT',interval:'1d',limit:2});
  const token=await fetchCandles({symbol:'PAXGUSDT',interval:'1d',limit:2});
  assert.equal(contract.symbol,'BINANCE:XAUUSDT');assert.equal(contract.meta.priceBasis,'perpetual');
  assert.match(contract.meta.warnings.join(' '),/不等同于/);
  assert.equal(token.symbol,'PAXGUSDT');assert.equal(token.meta.priceBasis,'spot');
  assert.equal(pyth.mock.callCount(),0);
  assert.ok(requests.some(url=>url.pathname.startsWith('/fapi/')&&url.searchParams.get('symbol')==='XAUUSDT'));
  assert.ok(requests.some(url=>url.pathname.startsWith('/api/v3/')&&url.searchParams.get('symbol')==='PAXGUSDT'));
});
