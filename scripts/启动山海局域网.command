#!/bin/zsh
set -euo pipefail
terminal_root="$(cd "$(dirname "$0")/.." && pwd)"
export TERMINAL_HOST=0.0.0.0
exec /bin/zsh "$terminal_root/scripts/启动山海终端.command" "$@"
