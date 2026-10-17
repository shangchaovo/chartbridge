#!/bin/zsh
set -euo pipefail
terminal_uuid="$(/usr/sbin/diskutil info -plist /Volumes/extradata 2>/dev/null | /usr/bin/plutil -extract DiskUUID raw -o - - 2>/dev/null || true)"
if [[ "$terminal_uuid" != "2AA45A36-F3AF-4818-BD38-BF9A293ABBA9" ]]; then
  print "请连接外接盘 extradata（指定卷 UUID 不匹配或尚未挂载）。"
  read -k 1 "?按任意键退出。"
  exit 1
fi
export TERMINAL_HOST=0.0.0.0
exec /bin/zsh /Volumes/extradata/Projects/tradingview-local/scripts/启动山海终端.command "$@"
