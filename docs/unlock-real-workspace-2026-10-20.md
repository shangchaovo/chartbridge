# 修复会话中断后的收尾:解锁真实工作区里被锁的仓位/矩形

日期:2026-10-20。接续 ChatGPT 分享会话(cx_6ad7837e4e888191b697fb17c6ef06a8,标题「逆向排查盈亏比拉取功能」)中断时未完成的一步。

## 背景

该会话已完成的代码修复(均在本仓库工作区,245 项测试通过):

1. 点击仓位触发 `setClickInstanceInfo → showSelection → setClickInstanceInfo` 无限递归,报 `Maximum call stack size exceeded`。修复在 `src/main.js` + `src/drawing-selection.js`(`showSelection` 的 `syncCanvas` 参数区分原生点击与程序主动选中)。
2. 锁定继承 bug:旧图形全被锁时,新画的图形也继承 `lock: true`。修复在 `src/main.js:444` 附近(lock-all 只作用于已有图形)。
3. 矩形只有两个对角锚点。按 TradingView 矩形模块补齐 9 个控制点,实现在 `src/rectangle-overlays.js`。

## 中断时未完成的一步

2026-10-21 审查更正：先前解锁脚本请求的是正常服务 `18765`，结果记录房间版本 15698，范围为 `BINANCE:SKHYNIXUSDT|4h` 的两个矩形和一个多头仓位。它不是只修改隔离目录。后续 GLM 又在其他图表检查到下列残留锁定，因此补充了更多对象的解锁。脚本请求地址、两个存储的读取口径及完整审查见 [GLM 同步审查](glm-sync-review-2026-10-21.md)。

## 本轮实际操作

- 通过 `GET http://127.0.0.1:18765/api/state` 读取运行中服务的真实工作区(`data/workspace.sqlite`,workspace.json 是旧的种子文件,勿改)。
- 构建 unlock 补丁:仅把用户画的 `longPosition`/`rect`/`horizontalStraightLine` 的 `lock: true` 翻转为 `false`,坐标与样式原样保留;`cursor-time-lock`(Shift+T 临时垂直光标锁)不动。
- 经 `PUT /api/state` 写回(服务端经 `enqueueState` 串行写库)。
- 验证:写回后全量 24 个 overlay 坐标零变化,无任何残留 `lock: true`;3 秒后再读仍未被旧标签页写回。

被解锁的 9 个图形:
- SNDKBUSDT|4h:3 个 rect
- BINANCE:INTCUSDT|4h:1 个 rect + 3 个 horizontalStraightLine
- INTC|1d:1 个 longPosition
- BINANCE:NVDAUSDT|4h:1 个 rect

## 验证清单

- `node --test tests/*.test.mjs`:245 通过 / 0 失败。
- 18765 服务提供的 `/src/main.js`、`/src/drawing-selection.js`、`/src/rectangle-overlays.js` 与工作树逐字节一致(`cmp`)——两轮代码修复都已在正常服务上生效。
- 真实工作区无残留锁定;用户刷新页面(Ctrl+F5)后所有仓位和矩形应可直接拖动。

## 注意

- 以上描述的是当时尚未保护整份保存时的风险。2026-10-21 已补齐工作区读取/写入的协作图表保护，旧整份 PUT 中的图形字段不能覆盖协作房间的最新锁定与坐标；后续不要将重复全量解锁作为常规恢复流程。
