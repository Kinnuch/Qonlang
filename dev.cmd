@echo off
rem 双击启动开发版（热更新）。不经过 PowerShell，不受执行策略限制。
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist node_modules (
  echo 首次运行，先安装依赖...
  call npm.cmd install --registry=https://registry.npmmirror.com
)
call npm.cmd run dev
pause
