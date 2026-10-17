# 山海 · 本地行情研究终端

一个在本机运行的 TradingView 风格研究终端。源码通过现有 Syncthing 在 Mac 与 Windows 双向同步：Mac 为 `/Volumes/extradata/Projects/tradingview-local`，Windows 为 `D:\Projects\tradingview-local`。依赖、缓存与运行数据各自保留在本机，不参与源码同步。

当前主服务在 Windows，Mac 通过 SSH 转发继续使用 localhost 页面。维护与冲突处理见 [Windows / Mac 实时同步说明](docs/windows-mac-sync.md)。

默认只监听 `127.0.0.1:18765`，不需要 TradingView 登录，也没有券商下单接口。图表和计算可以在下载后离线使用，获取新行情需要联网。

## 这个项目在解决什么问题

以前的工作流是三段割裂的：**TradingView 里看图做分析** → **截图/口述给 agent 让它解读** → **回交易所开单，每次还要反复粘 API key 给工具**。这个终端想把三件事合成一个本地工作台：

1. **agent 直接读本地图表**——所有行情、K 线、指标结果都是本机 REST/SSE 接口，局域网里的 agent 通过 MCP 接口就能按合约参数调用计算、读取图表与批注，不需要再在 TradingView 里截图搬运。
2. **图表就是双向画布**——我在图上画的意图（支撑/目标/失效位）本来就在本地数据层；agent 可以读取并引用它们，也可以把分析结论以批注/标线的形式画回图里，作为我下一次开单的清晰参考。
3. **仓位作为分析的常驻输入**——用只读凭据把交易所（币安等）的实际持仓、开仓成本接进来持久化在本机，agent 分析图表时自动带上真实的成本与持仓事实，不再每次现给 key；只读凭据只保存在本机数据目录。

定位是**研究与参考工作台，不是执行系统**：终端没有任何下单接口，开单动作永远留在交易所侧由人完成。这也是它可以在保留大权的前提下放心接只读凭据的原因。

当前进展（2026-10-17）：1 与 2 的基础已可用（MCP 指标/回测/共享批注、多交易所行情），3（账户接入）与 agent 主动在图上标画是下一阶段。

## 启动

Windows 双击项目根目录 `start-windows.cmd`；当前已配登录后台启动。Mac 普通启动器会优先连接已配置的 Windows 主机。

本机使用双击 `scripts/启动山海终端.command`；供同一局域网的其他电脑和 Agent 使用，双击 `scripts/启动山海局域网.command`。保持终端窗口打开。已在本机模式运行时，先 Ctrl+C 再切换局域网模式。

主机页面的「协作与 Agent → 局域网连接凭据」显示 LAN 地址及只读/编辑凭据，无需行情平台账户。详细步骤与 Agent 示例见 [局域网与公开行情使用说明](docs/lan-and-live.md)。

也可在项目目录执行：

```sh
npm ci --cache .npm-cache --ignore-scripts --no-fund --no-audit
npm start
```

打开 http://127.0.0.1:18765/ 。`npm start` 会先从本地依赖生成 `dist/`，无远程 CDN，也不依赖 Vite、Docker、数据库服务或原生构建工具。Node 需 22.19 或更高，当前机器为 22.23.2。

开发时用 `npm run dev`；它监听 `src/` 的修改并重新生成静态文件，浏览器手动刷新。停止服务按 Ctrl+C。

## 已实现功能（0.4）

- 图表：蜡烛、空心蜡烛、OHLC、折线，多周期与鼠标缩放拖动；技术指标叠加与参数调整；同标的双周期对照。
- 画线：五组菜单共 22 种工具，含通道、三点斐波那契扩展、圆/三角形/箭头及价格/时间区间测量；普通/弱/强磁吸、连续绘图、对象管理、锁定/显隐、文字与样式编辑，按标的与周期保存。支持最近 80 步绘图撤销/重做。
- 研究：逐根回放、CSV 导入导出、图表截图、持久化自选、价格条件提醒、工作区导入导出、明暗主题。
- 交互：图表右键菜单、全屏、快捷键说明与图表设置；线性/对数/百分比刻度、反转价格轴及网格/光标/最新价/水印开关。
- 脚本：真实 PineTS 0.11.1 执行原生 Pine v5/v6，提供 EMA、RSI、MACD 与策略示例；在断网权限的工作线程执行，15 秒超时停止。支持输出线/柱与形状标记。
- 回测：独立 EMA / RSI / 买入持有引擎，收盘信号下一根开盘成交，双边费率/滑点，权益、回撤、胜率、交易明细和 JSON 导出。

Pine 编辑器按 ⌘ Enter 运行；⌘ S 保存布局；`/` 打开标的搜索。价格提醒仅在页面打开、自动刷新开启、对应在线行情更新时检查，不是后台通知服务。

## Agent 计算与共享研究

局域网 Agent 现在可以通过 MCP 计算 SMA、EMA、RSI、MACD、ATR、布林带，或运行现有 EMA / RSI / 买入持有回测。只读凭据可计算，编辑凭据可进一步把结论写成共享批注；计算本身不修改图表。界面「协作与 Agent」也能预览同一接口的结果、导出 JSON 并加入批注。

结果包含来源与缓存状态、实际样本区间、收盘推定口径、排除条数和样本 SHA256。最多 1000 根历史、8 个指标，主机最多同时计算两项；远端只提交已定义的参数，不接受自定义脚本在服务端执行。Pine 编辑器继续在浏览器独立工作线程执行用户脚本。

接入参数、示例与限制见 [Agent 计算与共享图表](docs/agent-research.md)。

## 多市场行情覆盖

默认目录包含 291 个加密、A股、港股、美股、ETF、外汇、国际期货与指数品种（其中 35 个 ETF）。搜索窗口可按市场与 ETF 分类浏览完整目录，支持代码、中文与英文名称；更多代码通过在线目录查询。支持 `600900`、`sh600900`、`SZSE:002594`、`700`、`NASDAQ:PANW` 等代码格式，以及 `OKX:BTC-USDC`、`KRAKEN:LINK/EUR` 等目录外现货代码直达。目录外代码会标注待行情源验证；数据源不提供时明确显示错误。

Binance 官方免密钥 WebSocket 接加密现货真实推送；OKX / Kraken 现货使用对应交易所公开接口；新浪公开报价轮询接 A股、港股和外汇。A股原生分钟/日线每 10 秒补拉；周线、港股与外汇历史继续使用 Yahoo。美股、国际期货和其他指数使用 Yahoo 历史及公开快照，须查看源延迟和报价时间。

研究工作台上边缘可上下拖动调整高度，自选栏左边缘可左右拖动调整宽度；双击边缘恢复默认大小，聚焦分隔条后也可用方向键调整。大小与隐藏状态保存在当前浏览器。隐藏按钮位于各面板标题栏右侧，顶部「研究面板 / 自选报价」可随时恢复；隐藏研究面板时 Agent 协作区域一并收起。

按用户当前范围，国内期货与账户行情默认停用，账户页不显示，也不启动账户桥。已有配置、源码、虚拟环境和研究数据保留；旧自选中的国内期货会隐藏，不影响其他行情订阅。国际期货 `GC=F`、`CL=F` 等仍保留，其连续代码可能换月，不能当作固定交割合约。

公开网页轮询不等于交易所级零延迟推送；源时间、报价距今时间和来源分别展示。请求结果保存在 `data/candles/`。更新失败时仅使用已下载的真实缓存，并明确标记缓存时间；不会生成模拟行情代替。

## Pine 与策略兼容范围

这不是完整 TradingView 或官方 Pine 引擎。PineTS 的原生 v5/v6 兼容仍为实验功能，预热、交易日历、时区、合约上下文和部分内置函数可能不同。

当前 `request.security()` 支持静态请求的独立标的数据、同周期跨标的和 Binance 更高周期；运行前加载对应独立数据集。默认 lookahead_off，经历史前缀测试避免提前读取高周期收盘。动态参数、低周期与其他市场跨周期日历尚未接入。复杂 `line/box/table/fill` 等视觉尚未完整呈现；输出会说明缺口。

Pine `strategy()` 返回实验统计；基础回测页使用独立、可核查的引擎，支持全仓长仓/空仓和小数数量。它不模拟 A股 T+1、整手、涨跌停、停牌流动性、税费、卖空、期货合约乘数/保证金/换月/交割或账户换汇。

在线回测使用已确认收盘数据；没有明确收盘状态时保守排除最后一根；CSV 由用户保证是已收盘数据。末根仓位按收盘价、扣费和滑点清算，并单独标记。回放期间 Pine 与回测只接收截至回放位置的序列。

## 数据与恢复

- `data/charts.sqlite`：共享图表、批注、画线、Pine 与带作者的版本历史。
- `data/access.json`：本机生成的局域网只读/编辑凭据，仅主机页面可查看。
- `data/workspace.json`：主机个人自选、主题、脚本收藏、提醒、导入行情及共享图表快照。共享状态以 SQLite 为准。
- `data/workspace.previous.json`：上一次保存的工作区。
- `data/candles/`：按标的、周期和数量存放的行情缓存。
- “导出工作区”可保存独立 JSON 备份；“行情与数据 → 导入工作区”可恢复。

CSV 标准表头为 `timestamp,open,high,low,close,volume`，也支持中英文别名。时间可为毫秒/秒 epoch、带时区 ISO 或 YYYY-MM-DD；无时区 ISO 日期时间按 UTC 并提示。导入会校验每一行、按时间排序，重复时间出现冲突会拒绝；不默默补造价格。

## REA 调查

官方源仓库另克隆在 `/Volumes/extradata/Projects/rea`。工具固定版本安装于本项目 `tools/`，通过 CLI 运行，没有改写 Codex/ Cursor 的全局配置。

```sh
node tools/node_modules/rea-agents/scripts/rea.mjs --version
node tools/node_modules/rea-agents/scripts/rea.mjs capture-browser-scenario work/tradingview-scenario.json --json > work/tradingview-capture.json
```

详见 `docs/rea-research.md` 与 `docs/rea-public-page-evidence.json`。REA 捕获的匿名公开界面用于了解交互和分工，没有恢复服务端 Pine、付费指标，也没有复制 TradingView 专有前端库。

## 验证与许可证

`npm test` 运行数据归一化、公开实时源、账户桥、事务与协作冲突、CSV、回测费用、Agent 指标/回测边界与 Pine 无未来数据等 114 项测试。可另运行 `python3 tests/tqsdk_bridge_test.py` 检查 Python 数据转换。浏览器交互验收见 `docs/verification.md`、`docs/lan-verification.md` 和 `docs/account-feeds.md`。

项目 AGPL-3.0-only；KLineCharts Apache-2.0，PineTS AGPL-3.0-only，REA MIT。完整文本和上游告知见 `LICENSE`、`licenses/`、`THIRD_PARTY_NOTICES.md`。
