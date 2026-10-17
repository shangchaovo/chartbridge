#!/bin/zsh
set -euo pipefail
export PATH="/Users/xieshangchao/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
terminal_uuid="$(/usr/sbin/diskutil info -plist /Volumes/extradata 2>/dev/null | /usr/bin/plutil -extract DiskUUID raw -o - - 2>/dev/null || true)"
if [[ "$terminal_uuid" != "2AA45A36-F3AF-4818-BD38-BF9A293ABBA9" ]]; then
  print "请连接指定的 extradata 外接盘。"
  exit 1
fi
if /usr/bin/curl --fail --silent --max-time 1 http://127.0.0.1:18765/api/health >/dev/null; then
  print "请先在原服务窗口按 Ctrl+C 停止，再使用账户启动器。"
  exit 2
fi
cd /Volumes/extradata/Projects/tradingview-local
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
exec /bin/zsh /Volumes/extradata/Projects/tradingview-local/scripts/启动山海局域网.command "$@"
