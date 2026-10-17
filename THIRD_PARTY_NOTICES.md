# 第三方组件

本项目源代码按 GNU AGPL v3 提供，完整文本见 `LICENSE`。项目未包含 TradingView 专有图表库、私有 Pine 脚本或付费指标源码。

- **KLineCharts 9.8.12** — Copyright liihuu and contributors，Apache-2.0。来源：https://github.com/klinecharts/KLineChart 。完整许可证见 `licenses/KLineCharts-Apache-2.0.txt`，上游 NOTICE 原样保留于 `licenses/KLineCharts-NOTICE.txt`。本地分发将 `process.env.NODE_ENV` 替换为 `"production"`，并在构建时应用 `scripts/patch-klinecharts.mjs`：修正快速点击丢弃第二个锚点的问题；固定锚点绘图中的双击按一次锚点处理，避免过早结束并生成无法恢复的图形。非绘图状态的双击行为保留。
- **PineTS 0.11.1** — Copyright LuxAlgo，AGPL-3.0-only。来源：https://github.com/LuxAlgo/PineTS 。完整许可证见 `licenses/PineTS-AGPL-3.0.txt`。使用官方 browser ES 构建；当前本地适配器限制输入数据范围及绘图方式。上游另提供商业许可，该许可并未包含在本项目中。
- **REA / rea-agents 6.5.0** — Copyright REA contributors，MIT。来源：https://github.com/morluto/rea 。仅作为独立研究工具安装在 `tools/`，不参与终端运行。完整许可证见 `licenses/REA-MIT.txt`。
- **Acorn / acorn-walk / Astring** — MIT，PineTS 的解析与代码生成依赖。许可证原样保留于 `licenses/`。

- **MCP TypeScript SDK** — `@modelcontextprotocol/server` / `core` 2.3.1，`node` 2.1.1，Apache-2.0；来源：https://github.com/modelcontextprotocol/typescript-sdk 。完整许可证保留于 `licenses/MCP-*.txt`。
- **ws 8.22.0 / Zod 4.6.7 / Hono / @hono/node-server** — MIT；许可证原样保留于 `licenses/`，作为 WebSocket 和 MCP 依赖使用。

- **TqSDK 3.10.2（可选）** — 如需国内期货账户桥，安装到未跟踪的 `.venv-tqsdk/`，版本与依赖见 `requirements-tqsdk.txt`；上游：https://github.com/shinnytech/tqsdk-python 。包内许可证原样保留于 `licenses/TqSDK-*.txt`，账户数据权限由上游账户授权决定。

第三方各自保留版权与许可证。行情为 Yahoo Finance、Binance 与新浪的外部数据，软件开源许可不授予行情再分发权。源代码可在本机项目目录直接查看；未将本终端公开部署。
