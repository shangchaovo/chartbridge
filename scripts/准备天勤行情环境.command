#!/bin/zsh
set -euo pipefail
terminal_root="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$terminal_root"
mkdir -p work/tqsdk-install-tmp .pip-cache
export TMPDIR="$PWD/work/tqsdk-install-tmp"
python3 -m venv .venv-tqsdk
.venv-tqsdk/bin/python -m pip install --cache-dir "$PWD/.pip-cache" -r requirements-tqsdk.txt
.venv-tqsdk/bin/python -c 'import importlib.metadata; print("TqSDK 环境已准备：" + importlib.metadata.version("tqsdk"))'
print "依赖与虚拟环境都在本项目目录内。尚未登录任何账户。"
