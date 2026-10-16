@echo off
chcp 65001 >nul
title VideoIndir - Kur
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dosyalar\Kur.ps1"
echo.
pause
