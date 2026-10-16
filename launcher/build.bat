@echo off
chcp 65001 >nul
cd /d "%~dp0"
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set CSC=%FW%\csc.exe
if not exist "%CSC%" (echo C# derleyicisi bulunamadi: %CSC% & pause & exit /b 1)
node make-ico.js || (pause & exit /b 1)
rem UI Automation (tarayici adres cubugunu okumak icin) WPF klasorunde, WebView2 DLL'leri lib\ klasorunde durur.
rem /platform:x64: WebView2Loader.dll x64 surumudur.
"%CSC%" /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /win32icon:VideoIndir.ico /lib:"%FW%\WPF" /lib:"%~dp0lib" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:UIAutomationClient.dll /reference:UIAutomationTypes.dll /reference:WindowsBase.dll /reference:Microsoft.Web.WebView2.Core.dll /reference:Microsoft.Web.WebView2.WinForms.dll /out:..\VideoIndir.exe Launcher.cs AppWindow.cs || (pause & exit /b 1)
rem Exe'nin calismasi icin WebView2 DLL'leri yanina kopyalanir
copy /y lib\Microsoft.Web.WebView2.Core.dll .. >nul
copy /y lib\Microsoft.Web.WebView2.WinForms.dll .. >nul
copy /y lib\WebView2Loader.dll .. >nul
echo Hazir: %~dp0..\VideoIndir.exe
rem Kaldir.exe: ayri, kucuk kaldirici (WebView2 gerektirmez)
"%CSC%" /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /win32icon:VideoIndir.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /out:..\Kaldir.exe Kaldir.cs || (pause & exit /b 1)
echo Hazir: %~dp0..\Kaldir.exe
