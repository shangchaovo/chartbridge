// Discovery metadata only. Every chart still comes from the existing public feed adapters.
const groups = [
  ['crypto', 'BINANCE', 'USDT', 'crypto', [
    ['LTCUSDT','莱特币 Litecoin / USDT'],['LINKUSDT','Chainlink / USDT'],['AVAXUSDT','Avalanche / USDT'],
    ['DOTUSDT','Polkadot / USDT'],['TRXUSDT','波场 TRON / USDT'],['BCHUSDT','比特币现金 Bitcoin Cash / USDT'],
    ['UNIUSDT','Uniswap / USDT'],['ATOMUSDT','Cosmos / USDT'],['NEARUSDT','NEAR Protocol / USDT'],
    ['APTUSDT','Aptos / USDT'],['ARBUSDT','Arbitrum / USDT'],['OPUSDT','Optimism / USDT'],
    ['SUIUSDT','Sui / USDT'],['TONUSDT','Toncoin / USDT'],['PEPEUSDT','Pepe / USDT'],
    ['SHIBUSDT','柴犬币 Shiba Inu / USDT'],['AAVEUSDT','Aave / USDT'],['FILUSDT','Filecoin / USDT'],
    ['ETCUSDT','以太经典 Ethereum Classic / USDT'],['XLMUSDT','恒星币 Stellar / USDT'],
    ['ICPUSDT','Internet Computer / USDT'],['INJUSDT','Injective / USDT'],['HBARUSDT','Hedera / USDT'],
    ['RENDERUSDT','Render / USDT'],['TAOUSDT','Bittensor / USDT'],['BTCUSDC','比特币 Bitcoin / USDC'],['ETHUSDC','以太坊 Ethereum / USDC'],
  ]],
  ['us', 'NASDAQ', 'USD', 'stock', [
    ['PANW','派拓网络 Palo Alto Networks'],['PLTR','帕兰提尔 Palantir'],['COIN','Coinbase'],['MSTR','微策略 Strategy'],
    ['AVGO','博通 Broadcom'],['INTC','英特尔 Intel'],['MU','美光 Micron'],['QCOM','高通 Qualcomm'],
    ['ARM','安谋 Arm'],['ASML','阿斯麦 ASML'],['ADBE','奥多比 Adobe'],['NFLX','奈飞 Netflix'],
    ['COST','好市多 Costco'],['PEP','百事 PepsiCo'],['CSCO','思科 Cisco'],['PYPL','PayPal'],
    ['CRWD','CrowdStrike'],['FTNT','飞塔 Fortinet'],['SNPS','新思科技 Synopsys'],['CDNS','楷登 Cadence'],
    ['INTU','Intuit'],['TXN','德州仪器 Texas Instruments'],['AMAT','应用材料 Applied Materials'],
    ['LRCX','泛林 Lam Research'],['KLAC','科磊 KLA'],['ADSK','欧特克 Autodesk'],['SBUX','星巴克 Starbucks'],
    ['BIDU','百度 Baidu'],['JD','京东 JD.com'],['PDD','拼多多 PDD Holdings'],['BILI','哔哩哔哩 Bilibili'],['NTES','网易 NetEase'],
  ]],
  ['us', 'NYSE', 'USD', 'stock', [
    ['TSM','台积电 TSMC'],['BABA','阿里巴巴 Alibaba'],['NIO','蔚来 NIO'],['XPEV','小鹏汽车 XPeng'],
    ['ORCL','甲骨文 Oracle'],['CRM','赛富时 Salesforce'],['IBM','国际商业机器 IBM'],['SNOW','Snowflake'],
    ['JPM','摩根大通 JPMorgan Chase'],['BAC','美国银行 Bank of America'],['GS','高盛 Goldman Sachs'],
    ['V','维萨 Visa'],['MA','万事达 Mastercard'],['BRK-B','伯克希尔 Berkshire Hathaway B'],
    ['WMT','沃尔玛 Walmart'],['KO','可口可乐 Coca-Cola'],['DIS','迪士尼 Walt Disney'],['MCD','麦当劳 McDonald’s'],
    ['NKE','耐克 Nike'],['BA','波音 Boeing'],['CAT','卡特彼勒 Caterpillar'],['GE','通用电气 GE Aerospace'],
    ['XOM','埃克森美孚 Exxon Mobil'],['CVX','雪佛龙 Chevron'],['JNJ','强生 Johnson & Johnson'],
    ['LLY','礼来 Eli Lilly'],['UNH','联合健康 UnitedHealth'],['PFE','辉瑞 Pfizer'],['ABBV','艾伯维 AbbVie'],
  ]],
  ['us', 'NYSE ARCA', 'USD', 'etf', [
    ['VOO','先锋标普 500 ETF'],['VTI','先锋全美股市 ETF'],['DIA','道琼斯 ETF'],['IWM','罗素 2000 ETF'],
    ['GLD','黄金 ETF SPDR Gold'],['SLV','白银 ETF iShares Silver'],
    ['HYG','高收益债 ETF'],['XLF','金融板块 ETF'],['XLE','能源板块 ETF'],['XLK','科技板块 ETF'],
    ['XLV','医疗板块 ETF'],['ARKK','方舟创新 ETF'],['EEM','新兴市场 ETF'],
    ['FXI','中国大盘股 ETF'],['KWEB','中国互联网 ETF'],
  ]],
  ['us', 'NASDAQ', 'USD', 'etf', [['TLT','美国长期国债 ETF'],['IEF','美国中期国债 ETF'],['SMH','半导体 ETF VanEck'],['SOXX','半导体 ETF iShares']]],
  ['cn', 'SSE', 'CNY', 'stock', [
    ['600900.SS','长江电力'],['601398.SS','工商银行'],['601939.SS','建设银行'],['601288.SS','农业银行'],
    ['601988.SS','中国银行'],['601088.SS','中国神华'],['601857.SS','中国石油'],['600028.SS','中国石化'],
    ['600030.SS','中信证券'],['601012.SS','隆基绿能'],['600276.SS','恒瑞医药'],['600309.SS','万华化学'],
    ['601899.SS','紫金矿业'],['600089.SS','特变电工'],['600050.SS','中国联通'],['688981.SS','中芯国际'],
    ['688256.SS','寒武纪'],['688012.SS','中微公司'],['601728.SS','中国电信'],['600941.SS','中国移动'],
  ]],
  ['cn', 'SZSE', 'CNY', 'stock', [
    ['000333.SZ','美的集团'],['000651.SZ','格力电器'],['002594.SZ','比亚迪'],['002415.SZ','海康威视'],
    ['002475.SZ','立讯精密'],['002714.SZ','牧原股份'],['000725.SZ','京东方 A'],['000063.SZ','中兴通讯'],
    ['300059.SZ','东方财富'],['300760.SZ','迈瑞医疗'],['300124.SZ','汇川技术'],['300308.SZ','中际旭创'],
    ['300502.SZ','新易盛'],['002230.SZ','科大讯飞'],['002371.SZ','北方华创'],['000568.SZ','泸州老窖'],
    ['002352.SZ','顺丰控股'],['002027.SZ','分众传媒'],
  ]],
  ['cn', 'SSE', 'CNY', 'etf', [
    ['510300.SS','华泰柏瑞沪深 300 ETF'],['510500.SS','南方中证 500 ETF'],['510050.SS','华夏上证 50 ETF'],
    ['588000.SS','华夏科创 50 ETF'],['512100.SS','南方中证 1000 ETF'],['512880.SS','国泰证券 ETF'],
    ['512480.SS','国联安半导体 ETF'],['518880.SS','华安黄金 ETF'],['513100.SS','国泰纳斯达克 100 ETF'],
  ]],
  ['cn', 'SZSE', 'CNY', 'etf', [['159915.SZ','易方达创业板 ETF'],['159919.SZ','嘉实沪深 300 ETF']]],
  ['hk', 'HKEX', 'HKD', 'stock', [
    ['9999.HK','网易 NetEase'],['9888.HK','百度 Baidu'],['1024.HK','快手 Kuaishou'],['9626.HK','哔哩哔哩 Bilibili'],
    ['2015.HK','理想汽车 Li Auto'],['9868.HK','小鹏汽车 XPeng'],['1211.HK','比亚迪 BYD'],['0175.HK','吉利汽车 Geely'],
    ['2318.HK','中国平安'],['1299.HK','友邦保险 AIA'],['0388.HK','香港交易所 HKEX'],['0941.HK','中国移动'],
    ['0883.HK','中国海洋石油 CNOOC'],['0857.HK','中国石油'],['1398.HK','工商银行'],['0939.HK','建设银行'],
    ['3988.HK','中国银行'],['3968.HK','招商银行'],['0981.HK','中芯国际 SMIC'],['0669.HK','创科实业 Techtronic'],
    ['2269.HK','药明生物 WuXi Biologics'],['1928.HK','金沙中国 Sands China'],['0016.HK','新鸿基地产'],
  ]],
  ['hk', 'HKEX', 'HKD', 'etf', [['2800.HK','盈富基金 Tracker Fund'],['2828.HK','恒生中国企业 ETF'],['3033.HK','南方恒生科技 ETF']]],
  ['forex', 'FX', 'CAD', 'forex', [['CAD=X','美元 / 加元 USD/CAD']]],
  ['forex', 'FX', 'USD', 'forex', [['NZDUSD=X','新西兰元 / 美元 NZD/USD']]],
  ['forex', 'FX', 'JPY', 'forex', [['EURJPY=X','欧元 / 日元 EUR/JPY'],['GBPJPY=X','英镑 / 日元 GBP/JPY'],['AUDJPY=X','澳元 / 日元 AUD/JPY']]],
  ['forex', 'FX', 'GBP', 'forex', [['EURGBP=X','欧元 / 英镑 EUR/GBP']]],
  ['forex', 'FX', 'CHF', 'forex', [['EURCHF=X','欧元 / 瑞士法郎 EUR/CHF']]],
  ['forex', 'FX', 'AUD', 'forex', [['EURAUD=X','欧元 / 澳元 EUR/AUD']]],
  ['forex', 'FX', 'CNH', 'forex', [['CNH=X','美元 / 离岸人民币 USD/CNH']]],
  ['forex', 'FX', 'SGD', 'forex', [['SGD=X','美元 / 新加坡元 USD/SGD']]],
  ['futures', 'NYMEX', 'USD', 'futures', [['NG=F','天然气 Natural Gas'],['BZ=F','布伦特原油 Brent'],['PL=F','铂金 Platinum'],['PA=F','钯金 Palladium'],['HO=F','取暖油 Heating Oil'],['RB=F','汽油 RBOB']]],
  ['futures', 'CBOT', 'USD', 'futures', [['YM=F','道琼斯 E-mini'],['ZB=F','美国长期国债期货'],['ZN=F','美国十年期国债期货'],['ZC=F','玉米 Corn'],['ZW=F','小麦 Wheat'],['ZS=F','大豆 Soybeans'],['ZM=F','豆粕 Soybean Meal'],['ZL=F','豆油 Soybean Oil']]],
  ['futures', 'CME', 'USD', 'futures', [['RTY=F','罗素 2000 E-mini'],['LE=F','活牛 Live Cattle'],['HE=F','瘦肉猪 Lean Hogs']]],
  ['futures', 'ICE', 'USD', 'futures', [['KC=F','咖啡 Coffee'],['SB=F','原糖 Sugar'],['CC=F','可可 Cocoa'],['CT=F','棉花 Cotton'],['DX-Y.NYB','美元指数期货 US Dollar Index']]],
  ['indices', 'SSE', 'CNY', 'index', [['000300.SS','沪深 300 指数 CSI 300'],['000016.SS','上证 50 指数'],['000905.SS','中证 500 指数'],['000688.SS','科创 50 指数']]],
  ['indices', 'SZSE', 'CNY', 'index', [['399006.SZ','创业板指数 ChiNext']]],
  ['indices', 'HKEX', 'HKD', 'index', [['^HSCE','恒生中国企业指数']]],
  ['indices', 'NASDAQ', 'USD', 'index', [['^NDX','纳斯达克 100 指数']]],
  ['indices', 'CBOE', 'USD', 'index', [['^VIX','波动率指数 VIX']]],
  ['indices', 'FTSE', 'GBP', 'index', [['^FTSE','英国富时 100 指数']]],
  ['indices', 'XETRA', 'EUR', 'index', [['^GDAXI','德国 DAX 指数']]],
  ['indices', 'PARIS', 'EUR', 'index', [['^FCHI','法国 CAC 40 指数']]],
  ['indices', 'OSAKA', 'JPY', 'index', [['^N225','日经 225 指数']]],
  ['indices', 'KRX', 'KRW', 'index', [['^KS11','韩国综合指数 KOSPI']]],
  ['indices', 'TAIWAN', 'TWD', 'index', [['^TWII','台湾加权指数']]],
  ['indices', 'ASX', 'AUD', 'index', [['^AXJO','澳洲标普 ASX 200 指数']]],
];

export const EXTRA_SYMBOLS = Object.freeze(groups.flatMap(([market, exchange, currency, type, rows]) =>
  rows.map(([symbol, name]) => Object.freeze({ symbol, name, market, exchange, currency, type, provider: market === 'crypto' ? 'binance' : 'yahoo' }))));

export function lookupCode(query) {
  let symbol = String(query).trim().toUpperCase();
  if (/^(SH|SSE|SHSE):?\d{6}$/.test(symbol)) symbol = `${symbol.match(/\d{6}$/)[0]}.SS`;
  else if (/^(SZ|SZSE):?\d{6}$/.test(symbol)) symbol = `${symbol.match(/\d{6}$/)[0]}.SZ`;
  else if (/^[036]\d{5}$/.test(symbol)) symbol += symbol.startsWith('6') ? '.SS' : '.SZ';
  else if (/^(?:HKEX:)?\d{1,5}(?:\.HK)?$/.test(symbol)) symbol = `${Number(symbol.replace(/^HKEX:/, '').replace(/\.HK$/, '')).toString().padStart(4, '0')}.HK`;
  else symbol = symbol.replace(/^(NASDAQ|NYSE|AMEX|ARCA|BATS|BINANCE):/, '');
  if (/^OKX:[A-Z0-9]{1,10}-[A-Z0-9]{1,10}$/.test(symbol)) return {symbol, market:'crypto', exchange:'OKX', currency:symbol.split('-').at(-1), type:'crypto', provider:'okx'};
  if (/^KRAKEN:[A-Z0-9]{2,10}\/(USD|USDT|USDC|EUR|JPY|GBP|BTC|ETH|SOL)$/.test(symbol)) return {symbol, market:'crypto', exchange:'KRAKEN', currency:symbol.split('/').at(-1), type:'crypto', provider:'kraken'};
  if (/^[A-Z0-9]{2,20}(USDT|USDC|FDUSD)$/.test(symbol)) return {symbol, market:'crypto', exchange:'BINANCE', currency:symbol.match(/USDT$|USDC$|FDUSD$/)[0], type:'crypto', provider:'binance'};
  if (/^\d{6}\.(SS|SZ)$/.test(symbol)) return {symbol, market:'cn', exchange:symbol.endsWith('.SS')?'SSE':'SZSE', currency:'CNY', type:'stock', provider:'yahoo'};
  if (/^\d{4,5}\.HK$/.test(symbol)) return {symbol, market:'hk', exchange:'HKEX', currency:'HKD', type:'stock', provider:'yahoo'};
  if (/^[A-Z]{3}(?:[A-Z]{3})?=X$/.test(symbol)) return {symbol, market:'forex', exchange:'FX', currency:null, type:'forex', provider:'yahoo'};
  if (/^[A-Z0-9]{1,5}=F$/.test(symbol)) return {symbol, market:'futures', exchange:null, currency:null, type:'futures', provider:'yahoo'};
  if (/^\^[A-Z0-9]{2,10}$/.test(symbol)) return {symbol, market:'indices', exchange:null, currency:null, type:'index', provider:'yahoo'};
  // Only uppercase input is treated as an explicit US ticker, not an English company name.
  if (String(query).trim() === String(query).trim().toUpperCase() && /^[A-Z]{1,8}(?:[.-][A-Z])?$/.test(symbol)) return {symbol, market:'us', exchange:null, currency:'USD', type:'stock', provider:'yahoo'};
  return null;
}
