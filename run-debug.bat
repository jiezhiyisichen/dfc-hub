@echo off
chcp 65001 >nul
title DFC HUB 本地后台

cd /d "%~dp0"

if not exist "node_modules\express" (
  echo 首次运行，正在安装依赖...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请检查 Node.js 与网络。
    pause
    exit /b 1
  )
)

echo 正在启动本地服务 http://127.0.0.1:4310/admin/
start "DFC Admin Server" cmd /k "node admin-server.js"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:4310/admin/"

echo 浏览器已打开。关闭弹出的服务窗口即可停止后台。
exit
