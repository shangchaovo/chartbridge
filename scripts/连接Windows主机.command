#!/bin/zsh
set -euo pipefail
terminal_label="local.shanhai.windows-tunnel"
terminal_domain="gui/$(/usr/bin/id -u)"
if ! /bin/launchctl print "$terminal_domain/$terminal_label" >/dev/null 2>&1; then
  print "本机还没有名为 local.shanhai.windows-tunnel 的用户 LaunchAgent。"
  exit 1
fi
/bin/launchctl kickstart "$terminal_domain/$terminal_label" 2>/dev/null || true
terminal_ready=0
for terminal_attempt in {1..40}; do
  if /usr/bin/curl --fail --silent --max-time 1 http://127.0.0.1:18765/api/health >/dev/null; then
    terminal_ready=1
    break
  fi
  sleep 0.25
done
if [[ "$terminal_ready" != 1 ]]; then
  print "尚未连到 Windows。请确认 主机、Tailscale 和 Windows 图桥服务正在运行。"
  exit 1
fi
if [[ "${1:-}" != "--no-open" ]]; then /usr/bin/open http://127.0.0.1:18765/; fi
print "已连接 Windows 图桥主机：http://127.0.0.1:18765/"
