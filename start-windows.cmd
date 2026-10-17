@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/en/download/ then try again.
  pause
  exit /b 1
)
node "scripts\start.mjs" --lan
if errorlevel 1 pause
