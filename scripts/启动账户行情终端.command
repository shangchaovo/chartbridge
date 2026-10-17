#!/bin/zsh
set -euo pipefail
terminal_root="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if /usr/bin/curl --fail --silent --max-time 1 http://127.0.0.1:18765/api/health >/dev/null; then
  print "请先在原服务窗口按 Ctrl+C 停止，再使用账户启动器。"
  exit 2
fi
cd "$terminal_root"
terminal_user_env="$(node -e 'const fs=require("node:fs");let c={};try{c=JSON.parse(fs.readFileSync("data/market-accounts.json","utf8"))}catch{}process.stdout.write(String(c.userEnv||"SHANHAI_TQ_USER"))')"
terminal_password_env="$(node -e 'const fs=require("node:fs");let c={};try{c=JSON.parse(fs.readFileSync("data/market-accounts.json","utf8"))}catch{}process.stdout.write(String(c.passwordEnv||"SHANHAI_TQ_PASSWORD"))')"
if [[ ! "$terminal_user_env" =~ '^SHANHAI_TQ_[A-Z0-9_]{1,40}$' || ! "$terminal_password_env" =~ '^SHANHAI_TQ_[A-Z0-9_]{1,40}$' || "$terminal_user_env" == "$terminal_password_env" ]]; then
  print "本机凭据变量名无效，请先在账户配置页修正。"
  exit 1
fi
print "凭据只用于本次启动的行情进程。密码输入不显示，也不保存到工作区文件。"
IFS='' read -r "terminal_tq_user?天勤 / 快期行情账户："
IFS='' read -r -s "terminal_tq_password?账户密码："
print
if [[ -z "$terminal_tq_user" || -z "$terminal_tq_password" ]]; then
  print "尚未提供凭据。需要免账户行情时，请使用普通局域网启动器。"
  exit 1
fi
export "${terminal_user_env}=${terminal_tq_user}" "${terminal_password_env}=${terminal_tq_password}"
unset terminal_tq_password
exec /bin/zsh "$terminal_root/scripts/启动山海局域网.command" "$@"
