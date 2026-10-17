#!/bin/zsh
set -euo pipefail
terminal_root="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
terminal_project="$terminal_root"
terminal_url="http://127.0.0.1:18765/"
export TERMINAL_HOST="${TERMINAL_HOST:-127.0.0.1}"
terminal_open_browser=1
if [[ "${1:-}" == "--no-open" ]]; then terminal_open_browser=0; fi
if [[ -n "${SHANHAI_VOLUME_UUID:-}" ]]; then
  terminal_uuid="$(/usr/sbin/diskutil info -plist "$terminal_root" 2>/dev/null | /usr/bin/plutil -extract DiskUUID raw -o - - 2>/dev/null || true)"
  if [[ "$terminal_uuid" != "$SHANHAI_VOLUME_UUID" ]]; then
    print "项目所在卷的 UUID 与 SHANHAI_VOLUME_UUID 不一致。"
    read -k 1 "?按任意键退出。"
    exit 1
  fi
fi
cd "$terminal_project"
if [[ -f work/windows-host.json && "${SHANHAI_RUN_ON_MAC:-0}" != "1" ]]; then
  exec /bin/zsh "$terminal_project/scripts/连接Windows主机.command" "$@"
fi
terminal_running_mode="$(/usr/bin/curl --silent --max-time 2 "${terminal_url}api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{let r=JSON.parse(s);if(r.app==="shanhai-market-terminal")process.stdout.write(r.mode)}catch{}})' 2>/dev/null || true)"
if [[ -n "$terminal_running_mode" ]]; then
  if [[ "$TERMINAL_HOST" == "0.0.0.0" && "$terminal_running_mode" != "lan" ]]; then
    print "本机模式正在运行。请在原服务窗口按 Ctrl+C，再双击局域网启动器。"
    exit 2
  fi
  if [[ "$terminal_open_browser" == 1 ]]; then /usr/bin/open "$terminal_url"; fi
  print "山海终端已在运行：$terminal_url"
  exit 0
fi
if [[ ! -f node_modules/pinets/package.json || ! -f node_modules/klinecharts/package.json || ! -f node_modules/@modelcontextprotocol/server/package.json || ! -f node_modules/ws/package.json ]]; then
  print "首次启动，正在安装本项目自己的依赖…"
  npm ci --cache .npm-cache --ignore-scripts --no-fund --no-audit
fi
if [[ "$terminal_open_browser" == 1 ]]; then
(for terminal_attempt in {1..40}; do
  if /usr/bin/curl --fail --silent --max-time 1 "${terminal_url}api/health" >/dev/null; then
    /usr/bin/open "$terminal_url"
    exit 0
  fi
  sleep 0.25
done) &
fi
print "山海 · 本地行情终端"
print "保持本窗口打开。关闭服务请按 Ctrl+C。"
npm start
