@echo off
chcp 65001 >nul
title VideoIndir - Kaldir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dosyalar\Kaldir.ps1"
echo.
pause
