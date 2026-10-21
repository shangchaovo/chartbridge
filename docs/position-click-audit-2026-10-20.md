# 盈亏比无法拖动：修复与实际点击验收

日期：2026-10-20。

## 确认的故障与修复

在隔离数据目录的真实 Chromium 页面中，通过左侧菜单选择多头仓位、单击放置即可复现：

```text
RangeError: Maximum call stack size exceeded
OverlayStore.setClickInstanceInfo
showSelection
Custom.onClick
OverlayStore.setClickInstanceInfo
showSelection
```

KLineCharts 9.8.12 的 `setClickInstanceInfo` 在提交新的选中实例之前调用 `onClick`。本地 `onClick` 调用 `showSelection`，而 `showSelection` 又在原生选中实例尚未更新时调用 `setClickInstanceInfo`，形成无限递归。绘制完成、点击未选中仓位、开始拖动未选中仓位等路径均会进入这条事件链，造成选中/拖动流程中断。

修复位于 `src/main.js` 和 `src/drawing-selection.js`：原生点击及选中通知只更新界面；程序主动选中（绘制完成、对象管理定位、开始拖动等）仍同步画布状态。`showSelection` 的 `syncCanvas` 参数明确区分这两种来源。

新增 `tests/drawing-selection.test.mjs`，直接使用项目安装的 KLineCharts `OverlayStore` 检查实际回调顺序，覆盖点击切换多空仓位、点击空白取消选中、程序主动选中，以及绘制预览和非用户绘图。未复制图表引擎实现来模拟测试。

## TradingView 公开前端模块核对

本轮通过独立匿名 Chromium 打开公开图表，明确点击预测/测量菜单中多头仓位的左侧图标位置，并取得浏览器实际加载的模块：

- [公开图表](https://www.tradingview.com/chart/?symbol=BINANCE%3ABTCUSDT)
- [实际仓位前端模块](https://static.tradingview.com/static/bundles/line-tool-risk-reward.22405baa305b037c9023.js)
- 模块 SHA-256：`8ea1121e86a87236cb9a587b33be8b4d9275c8097b4b577d976f6b3ed56c926e`
- [官方多头仓位说明](https://www.tradingview.com/support/solutions/43000517002-long-position-drawing-tool/)

核对 `getPoint`、`setPoint`、`_changeEntryPoint` 及绘制锚点的代码后，确认：

| 原版控制点 | 交互职责 | 本地验收 |
|---|---|---|
| 0，左侧入场点 | 修改入场价，保留止盈/止损价格，并约束入场价不能越过两者 | 通过 |
| 1，右侧入场线末端 | 修改横向时间范围，价格仍等于入场价 | 通过 |
| 2，左侧止损点 | 修改止损价格，使用垂直调整光标 | 通过 |
| 3，左侧目标点 | 修改目标价格，使用垂直调整光标 | 通过 |
| 区域背景 | 可命中并整体移动图形 | 通过 |

本地仍使用兼容已有计划的三个语义价格锚点进行存储，显示四个操作手柄。没有为此重写已有价格与仓位计算，也没有将 TradingView 的模块复制进产品。

公开页面选择该工具后仍显示注册/登录要求。因此，本轮取得的是实际前端代码及原版菜单、登录限制的证据；没有在已登录的 TradingView 上完成放置和数值对比，不声明完整原版等价。原版代码还包含历史成交状态、换汇及其他统计功能，本轮未实现这些额外范围。

原始模块、资源 URL/哈希清单、菜单与登录限制截图保存在 `work/position-public-20261020/`。

## 实际点击与拖动验收

使用端口 18767 的独立测试服务和 `work/position-ui-check-data` 数据目录，行情使用本机真实历史 OHLCV 缓存；推送连接在测试中隔离。测试仅注入读取状态和坐标的观察函数，未调用内部选中、创建、修改或删除函数代替用户操作。

### 仓位与绘图

`work/position-and-click-audit.mjs` 完成 31 组验收，结果为通过；浏览器运行异常 0，配置/绘图保存失败 0。

| 范围 | 实际操作 |
|---|---|
| 多头与空头 | 菜单选择、单击创建、空白取消选中、再次点击色块、反复切换选中 |
| 四个手柄 | 止盈、止损、入场、宽度逐一拖动，检查对应价格与时间是否变化，以及其他价格是否保留 |
| 整体移动 | 未选中时直接拖区域，检查自动选中、三个价格同步平移且价差保留 |
| 编辑操作 | 拖动撤销/重做、锁定/解锁、设置页签、1:2 快捷比例、保存、无效参数拒绝、取消 |
| 管理与保存 | 双击设置、JSON 导出、克隆、图层前后调整、隐藏/恢复、对象定位、删除/撤销/重做、刷新恢复 |
| 价格轴 | 线性、对数、百分比和反转轴下实际拖动 |
| 窄屏 | 390px 参数窗口无横向溢出，确定/取消按钮可见 |
| 全部绘图入口 | 当前目录内全部 37 种工具逐一选择并实际绘制完成，打开设置、取消、删除、撤销、重做 |

37 种工具的逐项结果保存在 `work/position-and-click-audit-20261020/results.json` 的 `drawingResults` 中，截图包括 `positions-fixed.png` 和 `mobile-position-settings.png`。

### 主要页面入口

`work/page-click-audit.mjs` 完成另外 25 组检查，全部通过；浏览器运行异常 0，配置/绘图保存失败 0。覆盖品种搜索、自选切换、已有真实缓存的 5m/1h/4h/1d 周期、全部 5 种图表类型、明暗主题、指标增删、设置保存/重置、时区、日期跳转与越界提示、5 个时间范围、适应图表、双图、面板/模块开关、市场筛选、刷新、磁吸、连续绘图、显隐、快捷键、对象管理、回放、策略回测、Pine EMA 示例、CSV/PNG/工作区 JSON 导出、协作入口、警报列表/日志、右键菜单、保存、全屏及不同宽度布局。

详细结果与截图保存在 `work/page-click-audit-20261020/`。

## 自动验证与范围

- 最新工作区全量自动测试：240 项通过，0 失败。
- 绘图、仓位、路径、曲线及自由绘制相关回归：47 项通过，0 失败。
- 构建、JavaScript 语法检查及 `git diff --check` 通过。
- 构建后从正常服务的 18765 端口读取 `src/main.js` 和 `src/drawing-selection.js`，均返回 HTTP 200，确认已提供修复后的选择事件代码。已有页面刷新后使用新资源。
- 未使用测试数据修改用户正在使用的图表或自选配置。

本轮是操作可用性验收。历史缓存不代表实时行情接通；没有本机缓存的其他周期、外部模型实际请求、真实通知送达、外部账户登录、实际跨端同步及交易执行没有据此标为通过。警报入口测试未触发对外通知。
