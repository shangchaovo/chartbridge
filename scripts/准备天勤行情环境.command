#!/bin/zsh
set -euo pipefail
export PATH="/Users/xieshangchao/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
terminal_uuid="$(/usr/sbin/diskutil info -plist /Volumes/extradata 2>/dev/null | /usr/bin/plutil -extract DiskUUID raw -o - - 2>/dev/null || true)"
if [[ "$terminal_uuid" != "2AA45A36-F3AF-4818-BD38-BF9A293ABBA9" ]]; then
  print "请连接指定的 extradata 外接盘。"
  exit 1
fi
cd /Volumes/extradata/Projects/tradingview-local
mkdir -p work/tqsdk-install-tmp .pip-cache
export TMPDIR="$PWD/work/tqsdk-install-tmp"
python3 -m venv .venv-tqsdk
.venv-tqsdk/bin/python -m pip install --cache-dir "$PWD/.pip-cache" -r requirements-tqsdk.txt
.venv-tqsdk/bin/python -c 'import importlib.metadata; print("TqSDK 环境已准备：" + importlib.metadata.version("tqsdk"))'
print "依赖与虚拟环境均在外盘。尚未登录任何账户。"
