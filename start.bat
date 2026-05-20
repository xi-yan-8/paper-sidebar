@echo off
chcp 65001 >nul
title Paper Sidebar - Claude Assistant

cd /d "%~dp0"

echo ================================
echo   Paper Sidebar 启动中...
echo ================================

if not exist "node_modules" (
    echo [1/2] 安装依赖...
    call npm install
) else (
    echo [1/2] 依赖已安装，跳过
)

echo [2/2] 启动服务 (端口 9876)...
echo.
echo 请在 Edge 中加载扩展:
echo   1. 打开 edge://extensions
echo   2. 开启"开发人员模式"
echo   3. 加载解压缩的扩展 → 选择 extension 文件夹
echo.
node server/index.js
pause
