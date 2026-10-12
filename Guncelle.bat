@echo off
chcp 65001 >nul
title VideoIndir Guncelle
rem GitHub'daki son surumu denetler; farkliysa yamayi indirip uygular.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Guncelle.ps1"
echo.
pause
