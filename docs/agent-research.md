# Agent 计算与共享图表

国内期货账户桥默认关闭。A 股、港股、美股、外汇、国际期货、指数与加密使用公开行情。

## 连接

1. 先在本机启动服务，打开 http://127.0.0.1:18765/ 。
2. 只在私网共享时，用局域网模式，并在「协作与 Agent → 局域网连接凭据」查看地址和凭据。
3. 其他设备输入只读或编辑凭据。地址可能随网络改变。
4. Agent 使用 Streamable HTTP MCP：`http://<主机>:18765/mcp`，请求头 `Authorization: Bearer <凭据>`。凭据不要放进 URL，也不要写入仓库。

只读凭据有 9 个查询/计算工具；编辑凭据额外提供共享图表修改工具。源快照可能延迟，计算成功不能证明该市场的行情实时。

## 在界面核对计算

打开「协作与 Agent → Agent 计算预览」，选择指标概览或当前基础回测策略，点击「计算预览」。指标概览使用 SMA20、EMA12、RSI14、MACD12/26/9；回测参数沿用「策略回测」中保存的设置。计算请求最多取 800 根真实历史，按收盘口径筛选后计算。

结果显示样本时间、有效条数、来源、费用/回撤或指标末值。可导出 JSON；编辑者可点击「加入共享批注」，把结果锚定在本次样本末根的时间与收盘价。其他电脑会收到同一批注。只读者可以计算与导出，不能发布。

CSV 仍由当前浏览器的 Pine/回测页处理，不会自动发给其他电脑或服务端计算接口。

## Agent 指标工具

调用 `terminal_compute_indicators`：

```json
{
  "symbol": "BTCUSDT",
  "interval": "1d",
  "limit": 800,
  "closedOnly": true,
  "tail": 5,
  "indicators": [
    {"type": "SMA", "period": 20},
    {"type": "EMA", "period": 12},
    {"type": "RSI", "period": 14},
    {"type": "MACD", "fast": 12, "slow": 26, "signal": 9},
    {"type": "ATR", "period": 14},
    {"type": "BB", "period": 20, "multiplier": 2}
  ]
}
```

指标使用当前编辑器相同的 PineTS 0.11.1 引擎；仍属于实验兼容，不能保证与 TradingView 逐项相同。返回 `series[].latest` 和 `points`，指标尚未完成预热时值为 `null`，不会填造数值。

每次最多 8 项指标，周期参数 1–500，单次历史 2–5000 根。更早的公开 K 线用 `before` 继续取，直到该源没有更早数据；本机补齐只写在本地缓存。`tail` 仅限制返回的末尾点数，计算始终使用本次完整有效样本。默认排除未确认的末根。只有主动指定 `closedOnly:false` 才允许含未收盘数据，并返回相应警告。

## Agent 基础回测工具

调用 `terminal_run_backtest`：

```json
{
  "symbol": "AAPL",
  "interval": "1d",
  "limit": 800,
  "tail": 20,
  "options": {
    "strategy": "ema-cross",
    "fast": 12,
    "slow": 26,
    "initialCapital": 100000,
    "feeBps": 10,
    "slippageBps": 5
  }
}
```

`strategy` 可选 `ema-cross`、`rsi`、`buy-hold`。RSI 参数为 `rsiPeriod`（默认 14）、`oversold`（30）、`overbought`（70）。收益、回撤和胜率返回小数，`0.1` 代表 10%。`tail` 限制返回的交易和权益点，`metrics` 始终来自完整有效样本。

只使用已收盘口径的数据；收盘信号在下一根开盘执行，买卖双边计费和不利滑点，末根按收盘价清算。模型为全仓做多/空仓、小数数量，无杠杆；没有模拟 T+1、整手、涨跌停、停牌流动性、卖空、税费、合约乘数、保证金、换月和币种换算。国际期货使用该模型时仅作为价格序列研究，不能当成实际合约盈亏。

## 判断结果依据，再决定是否发布

两项工具都返回 `data`：标的和周期、请求/收到/使用/排除的条数、样本起止时间、末根收盘价、收盘口径、源元数据与缓存状态、样本 SHA256。

源有明确 `closed:true` 时计入确认收盘；缺失收盘标记的前序历史按顺序推定，并排除未确认末根，返回 `assumedClosedBars` 和警告。该口径与界面基础回测一致，尚未用全部交易所日历逐根验证。`data.quoteTime` 是源报价时间，`data.to` 是样本末根开盘时间，`computedAt` 才是本次计算时间，三者含义不同。

`cache:stale` 会明确保留并警告，计算不会把旧数据标成实时数据。SHA256 用来对照是否用了相同的 OHLCV 样本，结果 JSON 不是完整历史行情归档。

计算本身不改图。Agent 需要共享结论时，先调用 `terminal_get_chart` 取得当前 `revision`，再用编辑凭据调用 `terminal_apply_chart_operations`，携带该 `baseRevision`、唯一 `batchId` 和 `upsert_note`。批注应带结果的标的、周期、样本范围、来源与时间，可用 `data.to` 和 `data.lastClose` 锚定。遇到版本冲突，重新读取并合并；不要强制覆盖别人的修改。

Agent 也可读写 `longPosition` / `shortPosition` 仓位计划。`points` 必须依次包含入场、止损、止盈三个锚点；`extendData` 是带数字与布尔值的仓位参数对象，不能用文字替代。支持资金、风险口径、数量模式、步长、乘数、杠杆、费用、滑点与显示参数，具体字段见 MCP 工具 schema 和 [仓位计算口径](position-planning-and-audit.md)。服务端再次校验价格方向与参数范围。写入仓位图形不会发送交易订单。

## 无需安装依赖的 Node 示例

在另一台电脑使用 Node 18+，设置环境变量 `SHANHAI_URL` 为主机地址、`SHANHAI_TOKEN` 为对应凭据，再运行随附的「Agent连接示例.mjs」。变量只设置在自己的终端环境中，不写进示例源码。

```sh
node Agent连接示例.mjs
node Agent连接示例.mjs --research indicators
node Agent连接示例.mjs --research backtest
```

前述命令只查询。使用编辑凭据，明确添加 `--share-research` 才发布计算批注：

```sh
node Agent连接示例.mjs --research indicators --share-research
node Agent连接示例.mjs --note "需要其他研究者参考的观察"
```

示例在发布前会重新读取版本，图表标的或周期已变时停止发布，要求重新计算。

同一接口也可通过已认证 REST 使用：`POST /api/research/indicators`、`POST /api/research/backtest`，JSON 参数与工具相同。主机同时最多计算两项，忙时返回 `RESEARCH_BUSY`；计算线程 10 秒超时终止，并限制 V8 堆。只接受已定义的参数，不接收远端自定义 Pine/JavaScript。浏览器 Pine 编辑器仍能独立执行用户脚本。

## 当前仍有的边界

加密现货接官方 WebSocket；A股、港股和外汇是公开报价轮询；美股、国际期货与其他指数仍需查看具体源延迟。当前没有免账户、全市场的交易所级实时流。

完整 Pine 兼容仍未实现。已支持静态跨标的、同周期请求，以及 Binance 的更高周期；动态请求、低周期、其他市场的跨周期日历和复杂策略撮合仍有缺口。没有恢复 TradingView 付费闭源指标。
