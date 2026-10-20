@echo off
rem Private LAN / Tailscale. For localhost only, use start-local-windows.cmd.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "TERMINAL_SERVE_HOSTS=shang.tailc2493b.ts.net:18443,shang.tailc2493b.ts.net"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/en/download/ then try again.
  pause
  exit /b 1
)
node "scripts\start.mjs" --lan
if errorlevel 1 pause
