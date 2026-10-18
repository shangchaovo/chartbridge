# ChartBridge · 图桥

**A shared market research workspace for people and AI agents.**

[简体中文](README.md) · English

ChartBridge runs locally and brings real market data, charts, drawings, trade plans, and agent collaboration into one workspace. Mark your reasoning on a chart, let an agent read that context through structured tools, and bring its research back to the chart instead of repeatedly passing screenshots between apps.

> ChartBridge connects **market data → charts → trading intent → agents**. It currently supports research and planning, with no exchange order-placement API. The application UI is primarily Chinese; this repository provides Chinese and English overview documentation.

![ChartBridge workspace with candlesticks, freehand drawings, watchlists, and drawing tools](docs/images/workspace.png)

*The screenshot uses real, locally cached historical data and demonstration drawings. It does not show a live quote or a trade recommendation.*

## Why ChartBridge exists

Market research often spans several disconnected places: chart analysis in one app, positions at an exchange, and an agent in a chat window. The plan on a chart is hard to compare with the actual account, and each handoff means explaining symbols, timeframes, and intent again.

ChartBridge focuses on three connections:

1. **A chart as shared context.** People and agents work with the same symbol, timeframe, market data, drawings, and annotations.
2. **Intent that stays on the chart.** Entry, stop, target, and risk budget become plans that can be saved, adjusted, and calculated.
3. **Positions connected to intent.** A future integration will bring local positions, cost basis, and account context alongside those plans. This connection is on the roadmap and is not implemented yet.

## Available today

| Area | Implemented capabilities |
| --- | --- |
| Market data and watchlists | Public OHLCV across several markets, search and watchlists, distinct venues and sources, local icons, paginated history and caching, source timestamps and delay labels |
| Charts and navigation | Candlestick, hollow candle, OHLC, pure line, and area views; eight timeframes; dual charts; price-scale controls; timezone selection; date navigation; bar-close countdown |
| Drawings and management | 32 tools, including lines, channels, Fibonacci tools, shapes, text, range measurements, brush, and translucent highlighter; style/coordinate editing, object management, visibility, locking, stacking, undo, and redo |
| Trade planning | Long/short position drawings with separate entry, stop, target, and width handles; risk-based sizing; fees, slippage, contract multiplier, estimated margin, persistence, and export |
| Price and volume studies | Anchored VWAP, regression channels, and fixed-range volume profiles explicitly labeled as candle-based estimates |
| Scripts and backtests | Experimental Pine v5/v6 editor, technical indicators, bar replay, and basic EMA/RSI/buy-and-hold backtests with fees, slippage, and trade records |
| Agents and collaboration | Streamable HTTP MCP; market/chart/drawing access; indicator and basic backtest calculations; drawing and anchored-note updates with editor credentials; conflict drafts |
| Alerts and import/export | Background price-reach alerts while the server runs, configurable notification channels, CSV, JSON workspaces, PNG chart exports, and partial watchlist/settings import from local TradingView configuration |

Supported timeframes are `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, and `1w`. Availability depends on the provider. See the [feature audit](docs/feature-audit-2026-10-18.md) for details and remaining differences.

## Quick start

Install **Node.js 22.19+** and npm. Public market-data access also depends on your network and upstream services.

```sh
git clone https://github.com/shangchaovo/chartbridge.git
cd chartbridge
npm ci --ignore-scripts --no-fund --no-audit
npm start
```

Open [http://127.0.0.1:18765/](http://127.0.0.1:18765/). `npm start` builds the local `dist/` resources and listens on localhost by default. Chart runtime assets are served locally without a remote CDN dependency.

| Purpose | Command or launcher |
| --- | --- |
| Local use | `npm start`; on Windows, double-click `start-local-windows.cmd` |
| Development | `npm run dev`; backend changes restart the server, frontend changes require a page refresh |
| Private-network sharing | `npm run start:lan`; on Windows, double-click `start-windows.cmd` |
| Build | `npm run build` |
| Test | `npm test` |

The npm commands also work on macOS and Linux. Existing macOS launchers with the former “山海” name remain available for compatibility.

Choose a symbol from search or your watchlist, switch timeframes, and draw on the chart. Position drawings record plans; the collaboration panel provides connection details for other users and agents.

## Connect an agent

The MCP endpoint is `http://<host>:18765/mcp`. On the host's local page, open **协作与 Agent → 局域网连接凭据** in the collaboration panel to obtain reader or editor credentials. Configure the MCP client's `Authorization: Bearer <token>` header.

- **Reader credentials** allow market queries, chart inspection, indicators, and basic backtests.
- **Editor credentials** additionally allow drawing and annotation updates. Writes include a chart revision to avoid overwriting newer edits.

A Node example requires no additional packages. Set `CHARTBRIDGE_URL` and `CHARTBRIDGE_TOKEN` in your own terminal, then run:

```sh
node scripts/agent-example.mjs
node scripts/agent-example.mjs --research indicators
node scripts/agent-example.mjs --research backtest
```

These commands only read and calculate. Publishing a research note requires editor credentials and the explicit `--share-research` flag. See [agent calculations and shared charts](docs/agent-research.md) for interfaces, setup, and calculation assumptions.

## Data sources and local storage

- Crypto adapters include public Binance, OKX, and Kraken interfaces. Other markets use web data sources such as Sina and Yahoo. Coverage, streaming, delays, and available history differ; an adapter does not imply live access to every symbol.
- Binance gold perpetuals and PAXG spot are separate gold-related instruments. Pyth Pro gold history requires your own authorization. These sources are not silently substituted for one another.
- If an upstream service is unavailable, previously downloaded data may be used with cache and timestamp labels. Missing prices are not filled with invented market data.
- Workspaces, the shared-chart database, credentials, and caches are stored in the untracked `data/` directory. Stop the server before copying that directory for a backup.

Read more about [data and private-network use](docs/lan-and-live.md) and [gold sources and Pyth authorization](docs/pyth-and-symbol-icons.md).

## Current boundaries and roadmap

ChartBridge is an independent open-source project under active development. It does not provide complete TradingView or Pine compatibility, and it does not include proprietary TradingView charting libraries or closed-source indicator code.

| Direction | Current state and next steps |
| --- | --- |
| Chart interactions | Extend tool-specific settings, paths/curves, timeframes, chart types, named templates, and multi-chart synchronization |
| Market semantics | Improve exchange calendars, session breaks/overnight sessions, corporate-action adjustments, contract rolls/specifications, and cross-source consistency |
| Positions and intent | Connect local positions, cost basis, and account context; current position drawings are independent research plans |
| Scripts, backtests, and alerts | Expand the Pine subset, drawing objects, execution rules, and advanced indicator/drawing alert conditions |

The independent basic backtester uses close-based signals and next-bar-open execution, mainly with fully invested long/flat positions. It does not model all exchange trading rules. Volume profiles use OHLCV estimates, and position margin is a planning estimate. Alerts depend on the local server remaining online; they are not an unattended cloud service.

## Access and privacy

- The default listener is `127.0.0.1`. Enable private-network mode only when sharing, and do not expose the service port directly to the public internet.
- Private-network mode uses HTTP and dedicated access tokens. Use a trusted network or secure tunnel, and keep tokens out of URLs, screenshots, and the repository.
- Model keys, data-provider authorization, and notification settings stay in local files or environment variables. Market requests and explicitly enabled model/notification requests still go to the configured services.
- Legacy local-storage keys, access identifiers, and `SHANHAI_*` compatibility settings remain supported, so the rename does not require clearing saved charts or preferences.

## Architecture and documentation

**KLineCharts** renders the charts and **PineTS** provides experimental Pine execution. The Node.js server handles market adapters, history caching, shared state, and MCP. REA is used for independent research and is not a runtime dependency.

- [Feature coverage, verification, and remaining gaps](docs/feature-audit-2026-10-18.md)
- [Position drawing usage and calculation assumptions](docs/position-planning-and-audit.md)
- [Agent calculations and shared charts](docs/agent-research.md)
- [Data sources and private-network use](docs/lan-and-live.md)
- [REA research and evidence limitations](docs/rea-research.md)

The detailed guides above are currently primarily Chinese. The project was previously called **山海 / Shanhai Terminal** and is now **ChartBridge · 图桥**.

## License

ChartBridge is licensed under [AGPL-3.0-only](LICENSE). KLineCharts uses Apache-2.0 and PineTS uses AGPL-3.0-only. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `licenses/` for the full notices.

Brand icons and external market data retain their own rights and terms. The project's software license does not grant market-data redistribution rights.
