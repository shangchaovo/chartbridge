# REA 与本地 TradingView 风格终端工程调查

**2026-10-17 更新**：已重新采集 Windows 匿名公开图表及五组绘图菜单，补齐 22 种绘图工具、绘图历史/对象管理、图表设置和全屏。当前实现与新证据见 [REA 界面对照与功能补齐](rea-ui-improvements.md)。下文保留 2026-10-15 的原始调查快照，其中品种数量、已接通交易所和 Pine 数据范围应以当前 README 与新验证记录为准。

核查日期：2026-10-15。REA 本地官方仓库版本为 **6.5.0**，快照提交为 `034342ba28c8e56c3746be92b78aa7299afa02bd`。本文件区分官方说明、本机实测与工程推断；已完成匿名公开网页与交互场景取证，详细结果见文末。

## 工程结论

REA 适合调查 TradingView 浏览器前端的交互、已下发脚本、模块关系与可观察网络行为，帮助独立实现相似功能。它不自带 TradingView 服务端 Pine 引擎、受保护指标源码或全市场数据授权。当前路线是 **KLineCharts 负责图表，PineTS 负责实验性脚本执行，本地行情适配层负责真实 OHLCV**，逐项验证后扩展；不能将这套实现称为 TradingView 全功能复刻或付费指标恢复成功。

## REA 6.5.0 实际提供什么

- 同一套 CLI/MCP 工作流连接 JavaScript/Electron、网页、原生二进制、.NET、Android、WASM 等分析能力；原生深度分析依赖 Hopper、Ghidra 或 IDA 等外部提供者。输出包含证据来源与限制，由代理据此编写、测试自己的实现。[官方 README](https://github.com/morluto/rea/blob/034342ba28c8e56c3746be92b78aa7299afa02bd/README.md)
- 网页工具可通过用户拥有的 Chromium CDP 会话观察页面结构、脚本、资源、网络/控制台元数据及截图；静态 bundle 分析可给出导入、路由、端点等候选关系。被动观察与会驱动页面的场景捕获属于不同工作流，不应混称为相同权限或证据。[网页观察](https://github.com/morluto/rea/blob/034342ba28c8e56c3746be92b78aa7299afa02bd/docs/browser-observation.md)
- `export_web_scripts` 只能导出已保留的脚本；导出不会执行 JavaScript，也不能证明已取得完整网站或证明某段代码曾执行。模块缺失、来源歧义和未保留的源码映射必须继续标为未知。[脚本导出边界](https://github.com/morluto/rea/blob/034342ba28c8e56c3746be92b78aa7299afa02bd/docs/website-script-export.md)
- `recover_javascript_sources` 基于调用者提供的 Wakaru 处理实际取得的 JavaScript。官方该适配器目前只声明 Linux x64 支持；恢复原变量名、完整原项目和任意运行时等价性均无保证。当前 macOS 上能观察浏览器，不代表该恢复链已经运行。[JavaScript 恢复说明](https://github.com/morluto/rea/blob/034342ba28c8e56c3746be92b78aa7299afa02bd/docs/javascript-recovery.md)

## 浏览器代码与服务端 Pine 的边界

TradingView 官方说明 Pine Script 在其服务器运行；受保护与仅限邀请脚本的源码只对作者可见。部分内置 Pine 指标可在官方编辑器查看，另一些内置功能并非 Pine，源码也不对外提供。[Pine 执行位置](https://www.tradingview.com/pine-script-docs/welcome/)、[源码可见性与内置指标](https://www.tradingview.com/pine-script-docs/faq/programming/)

因此，“获取网页 JavaScript”不能推出“获取服务端 Pine 源码”。页面可能接收到指标数值或绘图结果；这些结果可用于有边界的行为比较，不能单凭有限样本唯一确定原算法。此处是架构与可识别性推断，不是对某个付费指标的恢复结论。

本次核查范围包括上述 REA 快照的 README、`docs/`、`website/evidence/`，以及在线[官方 showcases 索引](https://rea.tools/showcase/)。展示涉及 DX-Ball、Notion、TH04、Aegis、CTF 等案例；在此范围内**未发现 TradingView 付费指标源码恢复的可复现案例**。没有检索全部 issues、未公开样例或第三方视频，不据此断言全网不存在。

## 为什么选择可独立运行的开源组件

TradingView 的 Advanced Charts、Trading Platform 是专有库；官方当前不提供个人、爱好、学习或测试用途许可。即便取得许可，这些客户端库也不含 Pine、Strategy Tester、Alerts、Bar Replay 和 TradingView 行情，数据仍须自己接入。因此把网页上的高级库文件挪进本地不能补齐目标功能。[官方库比较与许可说明](https://www.tradingview.com/free-charting-libraries/)、[高级图表 FAQ](https://www.tradingview.com/charting-library-docs/latest/resources/Frequently-Asked-Questions/)

本项目锁定 KLineCharts **9.8.12**，提供蜡烛图、技术指标与绘图接口，许可证为 Apache-2.0；PineTS **0.11.1** 接收原生 Pine 与自有 OHLCV，在本地执行并返回绘图序列。PineTS 是独立项目，完整 Pine 兼容仍是目标，不等于 TradingView 官方引擎。锁定包的许可证为 AGPL-3.0-only；本项目已采用相同许可证，之后分发或提供网络服务应按许可证安排源码与告知，或另取适用商业许可。[KLineCharts 官方仓库](https://github.com/klinecharts/KLineChart)、[PineTS 官方能力与许可](https://github.com/LuxAlgo/PineTS)

## 行情覆盖与已验证边界

本机已通过公开只读端点取得 AAPL、0700.HK、600519.SS、000001.SZ、EURUSD=X、GC=F、^GSPC 与 BTCUSDT 的样本行情，覆盖美股、港股、A 股、外汇、国际期货、指数及加密现货。9 组周期/品种请求成功，**这不代表全部品种或全部市场接入已完成**。原始响应、标准化结果与时间记录保存在项目 `work/market-data-probe-*.json`、`work/market-data-live-*.json`。

- Yahoo 官方延迟表列示：沪深股票 30 分钟，港交所/恒指 15 分钟，COMEX/NYMEX 30 分钟，CME/CBOT 10 分钟；部分美股、指数与汇率列为实时。应用仍通过 REST 快照获取，不能等同于交易所逐笔推送。Yahoo 网页端点没有稳定开放承诺，且官方限制数据再分发。[官方覆盖及延迟](https://help.yahoo.com/kb/SLN2352.html)
- Binance 使用官方无密钥、仅公共市场数据的 `data-api.binance.vision`，当前为现货单交易所数据。报价涨跌幅为滚动 24 小时，与股票日涨跌口径不同。[官方只读端点](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)
- 当前 Yahoo 不提供原生 4h，明确返回不支持；1m 只请求最近 5 天，5m/15m/30m 请求最近 1 个月。更长历史、盘前盘后及跨周期重采样需要单独实现和验证。中国境内期货尚未接入；`GC=F` 等国际期货通用代码可能换月，不能代替固定交割合约。
- OKX、Kraken 在本机探测出现 TLS EOF，未列为已接通来源。网络失败不会替换成模拟行情；本地目录只是品种元数据。中文名称目前搜索 47 个内置品种，更多品种需用代码或英文远程搜索。

## 当前 Pine 与回测兼容缺口

以下为当前项目代码边界，不是 TradingView 等价性声明：

- Pine 编辑器接入 PineTS v5/v6，绘图层主要呈现线、柱与形状标记。部分面积、阶梯等样式会简化；复杂对象、表格、填充、精确标记位置和所有内置函数不能假定兼容。
- `request.security()` 当前只允许已载入的同标的、同周期数据；动态标的、跨交易所同名 ticker、跨周期与跨标的数据须另行加载，不能拿当前序列冒充。交易日历、时区、合约乘数、最小跳动和换汇等上下文尚不完整。
- Pine `strategy()` 统计属于实验结果；独立基础回测仅包含 EMA、RSI、买入持有三种方案，按收盘信号在下一根开盘成交，计费率与滑点，末根强制清算。当前全仓做多、允许小数数量，不模拟 A 股 T+1、涨跌停、整手、停牌流动性、做空、杠杆、保证金、换月或交割。
- 在线基础回测保守排除最后一根未确认收盘的 K 线；导入数据的收盘状态由数据提供方保证。不同数据源、复权与交易时段本身即可造成指标和成交差异。应以官方策略撮合定义建立对照，不能只比较最终净利润。[TradingView 策略与撮合说明](https://www.tradingview.com/pine-script-docs/concepts/strategies/)

## 下一步优先级

1. **补齐运行证据。** 用 REA 记录公开 TradingView 场景及脚本来源，保存版本、目标 URL、证据 ID、缺失项；对本地图表、画线、周期切换分别设计可重复的行为检查。
2. **完善数据语义。** 增加交易所日历、时区/DST、午休与夜盘、已收盘标志、复权、行情新鲜度、合约乘数与跳动单位。中国期货可以评估官方 TqSDK；它要求使用者自己的快期账户和 `TqAuth`。仓库不附带账户，也没有把真实登录写成已完成的接入。[TqSDK 官方快速入门](https://doc.shinnytech.com/tqsdk/latest/quickstart.html)
3. **建立多数据序列执行层。** 按标的、交易所、周期、复权与会话缓存数据，为 `request.security()` 提供正确的历史对齐、缺口处理和 lookahead 语义，再逐步扩展跨周期/跨标的脚本。
4. **做兼容性与撮合对照。** 选用用户拥有源码或允许使用的公开脚本，固定同一输入数据，逐根比较 SMA/EMA/RSI、状态变量、重绘、信号与订单；再补多空、手数、保证金、币种与期货换月。每项只公布实际验证范围。

## 本机 REA 运行取证结果

本地用固定版本的 `rea-agents` CLI，在独立、无登录的浏览器配置中查看公开图表页。REA 结束后清理自己的浏览器进程，不读取日常浏览器会话，也不改全局 MCP 配置。

- 基础公开页：`ev_cec1a74e654ffa964c4c96e78dc0df3a6670086479d80896283818a2bda25578`，约 15.7 秒，获取可访问性结构、截图及 2,127 条网络元数据事件，所选事件无丢弃。实际看见日线 BTCUSDT 图、顶部工具、左侧绘图工具、右侧自选与报价。
- 周期菜单场景：`ev_709fda20886f88b8a5d0e2359f1fdbbe852719d3303258e80d39d2f7d2d983d2`，实际展开周期菜单，包含分钟/小时/日/周/月等。该联合场景后续的打开指标步骤超时，最后一步取消；未将联合交互记为成功，超时原因未进一步确定。
- 独立指标窗口：`ev_1d7d2113d1135dd5bd37c4a8a945497ff445a6073d2ec6fa30acb840415f8d77`，重新从公开页面点击指标按钮，所有步骤完成。窗口内实际可见搜索、内置指标/策略及社区分类。

完整原始记录位于 `work/tradingview-capture.json`、`work/tradingview-interactions-capture.json`、`work/tradingview-indicators-capture.json`，请求定义也在同一目录。可审阅的摘要位于 `docs/rea-public-page-evidence.json`；公开页面和指标窗口截图保存在 `work/tradingview-public.png`、`work/tradingview-indicators.png`。

这些证据支持页面结构和有限交互的观察，不支持源码恢复结论：本轮没有导出专有 JavaScript 库、没有恢复服务端 Pine、没有提取受保护指标。网络事件仅为捕获窗口内的元数据，不是全部后台逻辑或全部响应内容。`completeness` 只针对该次请求选择的证据，不代表完整 TradingView 已被分析。

本地实现通过独立开源组件提供相似工作流。界面相似不等于 Pine、数值或交易规则等价。回归用 `npm test`。
