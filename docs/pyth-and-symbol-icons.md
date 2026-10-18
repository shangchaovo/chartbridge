# PYTH 授权与品种图标

## 免费黄金来源

本机打开 `http://127.0.0.1:18765/?settings=gold`，可直接使用两种无须数据 Key、没有试用期限的公开行情：

| 品种 | 真实来源及口径 | 本机核实的日线起点 |
| --- | --- | --- |
| `BINANCE:XAUUSDT` | 币安黄金 USDT 永续合约，有合约基差 | 2025-12-11 |
| `PAXGUSDT` | 币安 PAX Gold 黄金代币现货，有代币溢折价 | 2020-08-28 |

点击任意“查看”按钮会一并添加这两个品种，下载 8 个周期的首批数据，并将日线、周线补到公开接口能提供的历史起点。其他周期先下载最近 1,000 根（若已有更长缓存则保留），向左拖动图表继续分页。行情保存在本机 `data/candles/series/`，准备任务进度保存在 `data/candles/free-gold-status.json`，重复运行会复用缓存和已有历史。公开接口仍有频率限制，服务方也可能调整规则；免费不表示服务永远不变。

这两种行情各自保留符号、缓存、画线和来源，均不冒充 `PYTH:XAUUSD`，也不与之拼接。PAXG 的黄金支持情况见 [Paxos 官方资料](https://docs.paxos.com/guides/stablecoin/paxg)。币安现货历史 K 线见 [官方 API 文档](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)。

若要求 **现货黄金 XAU/USD** 的分钟或 Tick 历史，可用 [HistData 免费下载](https://www.histdata.com/download-free-forex-historical-data/)。这是历史文件来源，本次未接自动下载；其 [说明](https://www.histdata.com/f-a-q/) 指定固定 EST（UTC−5，不应用夏令时）、Bid 价格且无成交量。转换时间后再导入本地 CSV，不能将文件时间直接当作 UTC。

未将 Dukascopy 设为默认源：虽然官网有免费网页导出工具，本机批量档案接口实测持续返回 429，并指向 [AWS Requester Pays 下载说明](https://www.dukascopy.com/wiki/en/development/data-export/)，该方式可能产生 AWS 请求及流量费用。

## PYTH 原始行情（可选）

PYTH 当前 [免费档](https://app.pyth.com/products) 不含 API 访问；试用 Key 的免费与长期 API 使用不同。免费方案不依赖 PYTH，原始 Key 配置仍保留在本机供已获授权时使用。

在本机打开 `http://127.0.0.1:18765/?settings=pyth`，或在「行情与数据」中找到「PYTH 黄金历史行情」。

1. 在 [Pyth Terminal](https://pythdata.app/) 登录并申请免费试用，选择「View your API key」。实际可读的历史范围及品种由官方授予的权限决定。
2. 将 Key 填入本机页面，点击「保存并验证黄金行情」。后端先请求 `Metal.XAU/USD` 的真实历史接口，成功后再替换本机配置。失败不会覆盖原有 Key。
3. 验证后自动下载日线、周线、4 小时和 1 小时；图表向左拖动时继续按所选周期取更早数据。重新打开授权页可以看到本次后台补齐结果。

Key 存在忽略提交的 `data/pyth.json`；自定义 `TERMINAL_DATA_DIR` 时跟随该目录。也支持 `PYTH_PRO_API_KEY`、`PYTH_API_KEY`、`PYTH_ACCESS_TOKEN` 环境变量，优先级按此前顺序，环境变量优先于文件。状态接口只返回是否配置、验证时间和补齐结果。局域网客户端不能查看或更新数据授权。不要把原始 Key 发到聊天、提交到 Git 或放进网址。

历史请求固定到官方 `https://pyth.dourolabs.app/v1/fixed_rate@200ms/history`，Bearer 头只在后端注入，不跟随重定向。保留 `PYTH:XAUUSD` 来源身份，不会换成其他黄金源。报价为历史 K 线收盘价，未提供的成交量置零并明确提示。短页、周末、授权窗口无数据不会被误判为完整上市历史。

官方资料：[API Key](https://docs.pyth.network/price-feeds/pro/acquire-api-key)、[历史接口](https://docs.pyth.network/price-feeds/pro/api/history)。

## 图标维护

`node scripts/sync-all-symbol-logos.mjs` 读取静态目录、本机已同步的实时目录、TradingView 导入品种及当前自选。它以公开的 TradingView 品种元数据及币安官方资产目录匹配品牌，下载到 `src/assets/logos/`，随后运行 `npm run build` 更新页面资源。

`src/assets/logos/sources.json` 记录品种、来源代码、资源 URL、SHA-256、失败及缺少品牌资源的列表。不会将报价币的图标用作资产图标。没有品牌资源的品种按货币对、商品或原始代码显示本地 SVG，图片失效时也保留文字标记。页面不依赖远程图片加载。

币安资产名称中明确标有 bStocks 的品种归入币安美股，包括尚无对应永续合约的股票代币。股票代币、现货、永续和券商股票保持各自代码与数据来源。
