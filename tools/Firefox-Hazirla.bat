@echo off
chcp 65001 >nul
rem Eklentinin Firefox surumunu uretir: extension-firefox\ klasoru ve VideoIndir-firefox.xpi
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js bulunamadi. & pause & exit /b 1)
node tools\build-firefox.js || (pause & exit /b 1)
echo.
echo Firefox'ta about:debugging#/runtime/this-firefox adresini ac, "Gecici Eklenti Yukle" ile extension-firefox\manifest.json dosyasini sec.
pause
