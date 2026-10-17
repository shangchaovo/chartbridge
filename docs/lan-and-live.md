# 山海 0.4：公开行情与局域网协作

当前服务运行在 Windows 主机，Mac 通过 SSH 转发使用原 localhost 地址；源码通过 Syncthing 双向同步，见 [跨平台维护说明](windows-mac-sync.md)。公开行情模式不需要 TradingView、券商或 TqSDK 账户。行情来自公开网络源，价格不会以模拟数据补齐。国内期货与账户行情已按当前需求默认停用，现有配置与研究数据保留。

## 启动与连接

1. Windows 主机已有登录后台启动；Mac 连接外盘后双击普通启动器即可连接 Windows。Windows 本机也可双击项目 `start-windows.cmd`。
2. 主机页面仍是 http://127.0.0.1:18765/ 。打开「协作与 Agent」，点击「局域网连接凭据」。
3. 其他电脑通过同一局域网或已连接的 Tailscale，打开界面列出的地址。地址以每次启动显示的值为准。
4. 在另一台电脑的网页中输入主机生成的只读或编辑凭据。这只是本终端的访问凭据，不是行情平台账户。凭据不放入 URL。

本机启动器 `scripts/启动山海终端.command` 保持仅本机监听。默认端口 18765；开发测试曾使用隔离端口 18766，测试图表和批注没有写入正式工作区。

## 行情如何更新

- **Binance 加密现货**：官方免密钥 WebSocket，订阅真实 ticker 和对应周期 K 线；保留源事件时间与明确的 K 线收盘标记。共享上游订阅、自动重连，浏览器重连后补拉历史。本机实测事件接收差约 130 毫秒，这不是全链路延迟保证。
- **A股**：新浪公开报价与原生分钟/日线；报价每 3 秒轮询，K 线每 10 秒补拉。周线仍使用有延迟的 Yahoo 源。
- **港股、外汇**：新浪公开报价轮询，历史图表仍使用 Yahoo；两个来源分别展示，不把一个来源的最新报价伪造成另一个来源的完整 OHLCV。
- **美股、国际期货与其他指数**：保留 Yahoo 历史与公开报价快照，报价最多每 15 秒请求；须查看具体源延迟和报价时间。尚未接入免账户的全市场交易所实时流。

「行情与数据」分别列出 K 线来源、报价来源、源时间与缓存状态。状态栏持续显示报价距今时间；超过 15 秒没有新推送时不会继续标为实时推送。公开网页源没有可验证的交易所全链路零延迟保证；停市后时间也会自然变旧，界面不假造新时间。日线源可能仅提供上一交易日及以前的 K 线，最新报价独立显示。

连续期货代码会随源换月，未复权处理换月跳空。没有把连续价格当成某一固定合约的可成交价格。

实现参考官方 [Binance 公共行情说明](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)、[WebSocket 文档](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)，以及开源 [AKShare 的新浪期货适配器](https://github.com/akfamily/akshare/blob/main/akshare/futures/futures_zh_sina.py)。本项目直接请求相同的公开源，不需要安装整个 Python 数据栈。

## 人与 Agent 共同编辑

共享内容：标的、周期、图表类型、技术指标及参数、按标的/周期保存的画线、Pine 源码、带时间和价格锚点的批注。主题、自选、个人脚本收藏和提醒仍属于各自工作区。远端浏览器的个人偏好留在该浏览器；主机个人工作区留在外盘。

每批修改携带读取时的 `baseRevision` 和唯一 `batchId`。服务器用 SQLite 事务校验版本、落盘状态与作者记录；重发同一批次不会重复提交。不相交的本地和远端修改自动合并。若同时修改同一字段、画线或批注，保留本地草稿，暂停发布并显示冲突；可以采用共享版本的冲突内容，或保留本地修改再提交，其他不冲突草稿会保留。

新提交的 Pine 代码不会自动执行，仍由研究者点击运行。共享批注仅作为参考，不触发交易。CSV 文件内容当前不会自动分发到其他电脑；共享 CSV 图表时，其他电脑仍需有相同的数据集。

## MCP 接入

在支持 Streamable HTTP MCP 的 Agent 中配置：

```text
URL: http://<主机局域网IP>:18765/mcp
Header: Authorization: Bearer <主机提供的只读或编辑凭据>
```

提供 9 个查询/计算工具：`terminal_search_symbols`、`terminal_get_candles`、`terminal_get_live_quote`、`terminal_get_feed_status`、`terminal_get_chart`、`terminal_get_chart_history`、`terminal_get_stream_endpoints`、`terminal_compute_indicators`、`terminal_run_backtest`。计算使用真实下载的历史，返回样本和来源，不自动修改共享图表；[参数与完整步骤](agent-research.md)。编辑凭据额外提供 `terminal_apply_chart_operations`。查询结果带来源、源时间和缓存/新鲜度信息，Agent 应据此判断数据是否适合当前研究。

编辑操作支持 `set_field`、`upsert_drawing`、`remove_drawing`、`upsert_note`、`remove_note`。每批最多 100 项；画线锚点使用毫秒时间戳及数值价格。发生版本冲突时，返回最新版本供重新读取、合并，不提供强制覆盖开关。

`scripts/agent-example.mjs` 是无需安装依赖的 Node 示例。另一台电脑设置 `SHANHAI_URL` 和 `SHANHAI_TOKEN` 后运行它，默认仅读取图表和实时行情；添加 `--note "批注文字"` 才会发布参考批注。添加 `--research indicators` 或 `--research backtest` 可计算；显式添加 `--share-research` 才发布计算批注，要求编辑凭据。需要 Node 18 或更高。不要把真实凭据提交到代码仓库。

需要持续订阅的 Agent 也可用相同 Authorization 头连接 `/api/stream?symbol=BTCUSDT&interval=1m` 和 `/api/chart/events?room=main`，接收 SSE 行情与图表变更。MCP 使用官方 TypeScript SDK 的 Node 适配器，已验证与官方 MCP Client 2.3.1 以及 2025-11-25 协议客户端握手。

## Pine 本轮进展

支持静态 `request.security()` 的独立标的数据，同周期跨标的，以及 Binance 24/7 市场更高周期。运行前由主线程读取每个请求的数据，再交给禁网络的 Pine 工作线程；不会复用当前 K 线冒充另一个周期。每次最多 8 个不同请求组合。

在 BTCUSDT 1 分钟图中可运行：

```pine
//@version=6
indicator("独立数据请求", overlay=false)
plot(request.security("BINANCE:ETHUSDT", "1", close), "ETH 1m")
plot(request.security(syminfo.tickerid, "60", close), "BTC 1h")
```

默认只接受 `lookahead_off`。历史测试验证 5 分钟收盘值不会提前出现在前 4 根 1 分钟 K 线，截断后的结果与完整结果的历史前缀一致。当前实时高周期值仍会随未收盘行情变化。

完整 Pine 兼容仍未完成：动态标的/动态周期、低周期请求、其他市场的跨周期交易日历、复杂图形与全部策略撮合语义仍有缺口，遇到不支持的请求明确报错。

## 保存与备份

正式数据目录为项目的 `data/`：`charts.sqlite` 保存共享图表与操作历史；运行时可能伴随 WAL/SHM 文件。`access.json` 保存本机生成的局域网凭据；`workspace.json` 和 `.previous.json` 保存主机个人工作区；`candles/` 保存真实行情缓存。

完整备份请停止服务后复制 `data/`；运行中的共享图表也可通过界面的「导出工作区」另存 JSON。导入工作区会恢复共享内容，仍需编辑权限。
