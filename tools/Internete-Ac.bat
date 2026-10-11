@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\helper"
where node >nul 2>nul || (echo Node.js bulunamadi. & pause & exit /b 1)
if not exist "bin\yt-dlp.exe" (echo Once VideoIndir.exe'yi bir kez calistirip yt-dlp/ffmpeg'in inmesini bekle. & pause & exit /b 1)
if not exist "bin\cloudflared.exe" (node "%~dp0get-cloudflared.js" || (pause & exit /b 1))

echo.
echo  Siteyi INTERNETE aciyorsun. Linki bilen herkes bilgisayarin uzerinden video indirebilir.
echo  Pencereyi kapatinca site kapanir. Link her calistirmada degisir.
echo.

rem Herkese acik ornek 9697 portunda calisir; yerel servis (9696) ayri kalir ve internete acilmaz.
set VI_PUBLIC=1
set VI_PORT=9697
set VI_HOST=127.0.0.1
set VI_TRUST_PROXY=1
set VI_ALLOWED_HOSTS=*.trycloudflare.com
start "VideoIndir (herkese acik)" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul

echo Asagida "https://....trycloudflare.com" seklinde bir adres gorunecek. Onu paylas.
echo.
bin\cloudflared.exe tunnel --no-autoupdate --url http://127.0.0.1:9697

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 9697 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Site kapatildi.
pause
