# VideoIndir kaldırıcı: uygulamayı, kısayolları, Windows kayıtlarını ve (istersen) ayar/geçmiş verilerini siler.
# İndirdiğin videolara DOKUNMAZ.
# Seçenekler: -Yes sormadan kaldır (ayarlar da silinir), -KeepData ayar ve geçmişi koru, -Target kaldırılacak klasör
param(
  [switch]$Yes,
  [switch]$KeepData,
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}   # konsolsuz (gizli) çalışırken hata vermesin

function Test-Under($path, $dir) { $path -and $path.StartsWith($dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }

try {
  # Kaldırılacak klasör: verilmediyse kurulu kopya, o yoksa bu scriptin bulunduğu klasör
  if (-not $Target) {
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\VideoIndir'
    $self = $PSScriptRoot
    if ((Split-Path $PSScriptRoot -Leaf) -eq 'dosyalar') { $self = Split-Path $PSScriptRoot -Parent }
    $Target = if (Test-Path (Join-Path $installed 'VideoIndir.exe')) { $installed } else { $self }
  }
  # Güvenlik: yalnızca gerçekten bir VideoIndir klasörünü sil
  $okFolder = (Test-Path (Join-Path $Target 'VideoIndir.exe')) -and ((Test-Path (Join-Path $Target 'dosyalar\helper\server.js')) -or (Test-Path (Join-Path $Target 'helper\server.js')))
  if (-not $okFolder) { throw "Burada bir VideoIndir kurulumu bulunamadı: $Target" }
  $Target = (Resolve-Path $Target).Path.TrimEnd('\')

  Write-Host ''
  Write-Host '  VideoIndir kaldırılıyor' -ForegroundColor Cyan
  Write-Host "  Silinecek klasör: $Target"
  Write-Host '  İndirdiğin videolar silinmez.'
  Write-Host ''
  if (-not $Yes) {
    $ans = Read-Host 'Kaldırılsın mı? [E/H]'
    if ($ans -notmatch '^[eEyY]') { Write-Host 'İptal edildi.'; return }
  }
  $wipeData = -not $KeepData
  if (-not $Yes -and -not $KeepData) {
    $a2 = Read-Host 'Ayarların ve indirme geçmişin de silinsin mi? (videolar silinmez) [E/H]'
    $wipeData = ($a2 -match '^[eEyY]')
  }

  # Çalışan uygulamayı ve servisini kapat
  Get-Process VideoIndir -ErrorAction SilentlyContinue | Where-Object { Test-Under $_.Path $Target } | Stop-Process -Force
  $l = Get-NetTCPConnection -LocalPort 9696 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) {
    $pr = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    if ($pr -and $pr.ProcessName -eq 'node' -and (Test-Under $pr.Path $Target)) { & taskkill /PID $pr.Id /T /F | Out-Null }
  }
  Start-Sleep -Seconds 1

  # Kısayollar
  foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
    Remove-Item (Join-Path $d 'VideoIndir.lnk') -Force -ErrorAction SilentlyContinue
  }
  # Windows kayıtları: Windows açılışında başlat, videoindir: bağlantısı, Uygulamalar listesi
  Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name VideoIndir -ErrorAction SilentlyContinue
  $proto = 'HKCU:\Software\Classes\videoindir'
  $cmd = (Get-ItemProperty (Join-Path $proto 'shell\open\command') -ErrorAction SilentlyContinue).'(default)'
  if ($cmd -and $cmd.IndexOf($Target, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Remove-Item $proto -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoIndir' -Recurse -Force -ErrorAction SilentlyContinue

  # Ayarlar, geçmiş ve uygulama penceresinin önbelleği
  if ($wipeData) {
    Remove-Item (Join-Path $env:APPDATA 'VideoIndir') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $env:LOCALAPPDATA 'VideoIndir') -Recurse -Force -ErrorAction SilentlyContinue
  }

  # Klasörü sil. Bu script de o klasörün içindeyse, kapandıktan sonra silinsin
  if (Test-Under $PSScriptRoot $Target) {
    Start-Process cmd.exe -ArgumentList '/c', "ping 127.0.0.1 -n 4 >nul & rmdir /s /q `"$Target`"" -WindowStyle Hidden
  } else {
    Remove-Item $Target -Recurse -Force
  }

  Write-Host ''
  Write-Host 'VideoIndir kaldırıldı ✓' -ForegroundColor Green
  Write-Host '  İndirdiğin videolar yerinde duruyor.'
  Write-Host '  Tarayıcıya eklenti kurduysan onu tarayıcının eklentiler sayfasından kaldır.'
}
catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
