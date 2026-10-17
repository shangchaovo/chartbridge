# Windows / Mac 实时同步与维护

当前源码使用现有 Syncthing，经 Tailscale 在 另一台同步设备 和 主机 间双向同步，无需 Git 提交。

- Mac 源码：`/Volumes/extradata/Projects/tradingview-local`
- Windows 源码：`D:\Projects\tradingview-local`
- Syncthing 文件夹 ID：`shanhai-terminal-src`
- 监视保存后的文件变化，聚合延迟 1 秒，5 分钟扫描兜底；实际传输耗时随网络与文件大小变化。
- 两端开启错峰版本历史，保留窗口 30 天；权限位不跨系统覆盖。

## 两台电脑如何维护

直接用各自编辑器或 Agent 打开上面的目录。源码、测试、依赖清单、文档和 `.syncignore` 会双向传播。保存后同步的是文件，不是编辑器里尚未保存的字符。

两人同时修改同一个文件时，Syncthing 可能生成 `sync-conflict` 副本；它不会替你按字符或语义合并。保留副本，对照两端修改后手动合并。需要同时观察和编辑图表时，使用同一个 Windows 山海服务中的共享图表、画线和批注。

`.syncignore` 是共享规则；两端本地 `.stignore` 都包含 `#include .syncignore`。`.stignore` 本身不会由 Syncthing 传输，因此新设备还需建立这一行本地文件。

## 依赖与数据

`node_modules/`、`dist/`、`work/`、`data/`、`.git/`、Python 虚拟环境、缓存、环境密钥文件和系统临时文件不在源码同步范围内。依赖按各自平台安装，前端产物在运行主机生成。

图表数据库与个人工作区只在主运行服务维护。当前工作区由 Mac 一次性迁到 Windows；Mac 原文件保留作回退。后续新的图表与批注以 Windows 的 `data/` 为准，不用 Syncthing 同步运行中的 SQLite、WAL 或访问凭据。

## 当前运行方式

Windows 承担服务、行情请求、Agent 指标与回测计算。Mac 不必运行 Node 服务。Mac 上的 `http://127.0.0.1:18765/` 通过已有 SSH/Tailscale 连接转发到 Windows，浏览器地址可以继续沿用。

Windows 本机：`http://127.0.0.1:18765/`。

其他已接入 Tailscale 的设备：`（以界面显示的地址为准）`，使用山海本身的只读/编辑凭据登录；MCP 地址为该地址加 `/mcp`。

Windows 使用登录启动项 `ShanhaiTerminal.lnk` 运行 `scripts/start-windows.vbs`，隐藏窗口并写日志至 `work/server.log`。启动器会检查已有实例，避免重复启动。桌面项目快捷方式用于打开源码目录；双击项目根目录 `start-windows.cmd` 可打开服务页面，`start-local-windows.cmd` 用于仅本机模式。

Windows 后台使用开发监听：前端源码和 `index.html` 保存并同步后自动生成静态资源，刷新浏览器查看；后端导入模块修改会自动重启。更改依赖清单后需重新安装依赖并重启启动器。常用命令：

```text
npm test
npm run build
npm run start:lan
```

Windows 已有 Node 24.16.0，本轮实际执行过安装、测试、构建和服务请求。首次安装的 npm 网络请求较慢，本轮以锁文件校验的包缓存完成 Windows 自己的安装。包缓存位于 Windows `work/npm-cache`；需要复用时可运行 `npm ci --offline --cache work/npm-cache --ignore-scripts --no-fund --no-audit`。

Windows 已开启的系统代理为 `127.0.0.1:10808`。本应用在本机 `work/network-env.json` 中为启动子进程配置 Node 的代理环境，解决直连 Yahoo 返回 403 的问题；没有更改系统代理或其他项目的环境。代理设置不随源码同步。若以后更换系统代理端口，请相应更新该本机文件并重启应用。

Mac 转发日志在 `~/Library/Logs/ShanhaiTerminal/windows-tunnel.log`。Mac 的转发由用户级 LaunchAgent `local.shanhai.windows-tunnel` 保持。普通 Mac 启动器在存在本机 `work/windows-host.json` 时优先连接 Windows。显式需要在 Mac 独立运行时，可先停止该转发，再设置 `SHANHAI_RUN_ON_MAC=1` 启动；此时 Mac 的旧数据只是迁移时留存的副本，不能代替 Windows 后续新数据。

## 排查

1. 同步慢：两台电脑均需在线，Syncthing 中此文件夹没有暂停，状态为已同步；Tailscale 可达主机。查看有无 `sync-conflict`、磁盘空间不足或同步错误。
2. Mac 本机页面打不开：确认 Windows 服务和 Tailscale 在线，再运行 Mac 的「连接Windows主机.command」。Windows 直接访问自己的 localhost 可区分服务问题与转发问题。
3. 页面没有反映源码变化：确认 Windows 已收到该文件，检查 `work/server.log` 是否完成构建/重启，再刷新浏览器。
4. 行情异常：检查源时间、缓存状态与来源；如果只有 Yahoo 市场异常，检查 Windows 已有代理及应用本机代理配置。旧缓存不会被标成新行情。

技术依据：[Syncthing 配置 API](https://docs.syncthing.net/rest/config.html)、[忽略规则](https://docs.syncthing.net/users/ignoring.html)、[Node 代理配置](https://nodejs.org/download/release/v24.15.0/docs/api/cli.html#node_use_env_proxy1)。完整 Pine 与全市场交易所实时行情仍不属于已经完成的能力。
