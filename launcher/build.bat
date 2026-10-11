@echo off
chcp 65001 >nul
cd /d "%~dp0"
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set CSC=%FW%\csc.exe
if not exist "%CSC%" (echo C# derleyicisi bulunamadi: %CSC% & pause & exit /b 1)
node make-ico.js || (pause & exit /b 1)
rem UI Automation (tarayici adres cubugunu okumak icin) WPF klasorunde durur
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 /win32icon:VideoIndir.ico /lib:"%FW%\WPF" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:UIAutomationClient.dll /reference:UIAutomationTypes.dll /reference:WindowsBase.dll /out:..\VideoIndir.exe Launcher.cs || (pause & exit /b 1)
echo Hazir: %~dp0..\VideoIndir.exe
