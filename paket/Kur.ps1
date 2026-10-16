# VideoIndir kurulumu: dosyaları kalıcı bir klasöre kopyalar, masaüstü ve Başlat menüsü kısayolu koyar,
# Windows'un "Uygulamalar" listesine ekler (oradan da kaldırılabilir). Yönetici izni gerekmez.
# Seçenekler: -Yes sormadan kur, -NoLaunch kurulunca açma, -Target başka bir klasöre kur
param(
  [switch]$Yes,
  [switch]$NoLaunch,
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}   # konsolsuz (gizli) çalışırken hata vermesin

# Zip'ten çıkarılan klasör (VideoIndir.exe burada, bu script ise "dosyalar" içinde)
$src = $PSScriptRoot
if ((Split-Path $PSScriptRoot -Leaf) -eq 'dosyalar') { $src = Split-Path $PSScriptRoot -Parent }
if (-not $Target) { $Target = Join-Path $env:LOCALAPPDATA 'Programs\VideoIndir' }

function Test-Under($path, $dir) { $path -and $path.StartsWith($dir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }

# Çalışan VideoIndir'i (ve servisini) kapat: yalnızca kaynak ya da hedef klasördekini
function Stop-VideoIndir($dirs) {
  Get-Process VideoIndir -ErrorAction SilentlyContinue | Where-Object { $p = $_.Path; @($dirs | Where-Object { Test-Under $p $_ }).Count -gt 0 } | Stop-Process -Force
  $l = Get-NetTCPConnection -LocalPort 9696 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) {
    $pr = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    if ($pr -and $pr.ProcessName -eq 'node' -and @($dirs | Where-Object { Test-Under $pr.Path $_ }).Count -gt 0) { & taskkill /PID $pr.Id /T /F | Out-Null }
  }
  Start-Sleep -Seconds 1
}

function New-Shortcut($lnk, $exe, $workDir) {
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $workDir
  $s.IconLocation = $exe
  $s.Description = 'VideoIndir - video ve MP3 indirici'
  $s.Save()
}

try {
  if (-not (Test-Path (Join-Path $src 'VideoIndir.exe'))) { throw "VideoIndir.exe bulunamadı. Zip dosyasını önce bir klasöre çıkar, sonra Kur.bat'ı çalıştır." }

  Write-Host ''
  Write-Host '  VideoIndir kurulumu' -ForegroundColor Cyan
  Write-Host "  Kurulacak yer : $Target"
  Write-Host '  Kısayollar    : Masaüstü ve Başlat menüsü'
  Write-Host ''
  if (-not $Yes) {
    $ans = Read-Host 'Kurulsun mu? VideoIndir açıksa kapatılır. [E/H]'
    if ($ans -notmatch '^[eEyY]') { Write-Host 'İptal edildi.'; return }
  }

  $same = ((Resolve-Path $src).Path.TrimEnd('\') -ieq $Target.TrimEnd('\'))
  Stop-VideoIndir @($src, $Target)

  if (-not $same) {
    Write-Host 'Dosyalar kopyalanıyor...'
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    # /E alt klasörler dahil; mevcut kurulumun indirilmiş araçlarını (yt-dlp, ffmpeg) silmez
    & robocopy $src $Target /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw 'Dosyalar kopyalanamadı. Hedef klasöre yazma izni olduğundan emin ol.' }
  }

  $exe = Join-Path $Target 'VideoIndir.exe'
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'VideoIndir.lnk') $exe $Target
  New-Shortcut (Join-Path ([Environment]::GetFolderPath('Programs')) 'VideoIndir.lnk') $exe $Target

  # "Windows açılışında başlat" daha önce açıldıysa yeni konuma taşı (eski klasör silinince bozulmasın)
  $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (Get-ItemProperty $run -Name VideoIndir -ErrorAction SilentlyContinue) {
    Set-ItemProperty $run -Name VideoIndir -Value ('"' + $exe + '" --silent')
  }

  # Windows Ayarlar > Uygulamalar listesine ekle
  $ver = '1.0.0'
  try { $ver = (Get-Content (Join-Path $Target 'dosyalar\extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoIndir'
  New-Item -Path $key -Force | Out-Null
  $unPs = Join-Path $Target 'dosyalar\Kaldir.ps1'
  Set-ItemProperty $key -Name DisplayName -Value 'VideoIndir'
  Set-ItemProperty $key -Name DisplayVersion -Value $ver
  Set-ItemProperty $key -Name Publisher -Value 'emiraneren'
  Set-ItemProperty $key -Name InstallLocation -Value $Target
  Set-ItemProperty $key -Name DisplayIcon -Value $exe
  Set-ItemProperty $key -Name UninstallString -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $unPs + '"')
  Set-ItemProperty $key -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty $key -Name NoRepair -Value 1 -Type DWord

  Write-Host ''
  Write-Host 'Kuruldu ✓' -ForegroundColor Green
  Write-Host "  Masaüstündeki 'VideoIndir' simgesiyle açabilirsin."
  if (-not $same) { Write-Host "  Zip'ten çıkardığın klasörü artık silebilirsin." }
  Write-Host '  Kaldırmak için: Ayarlar > Uygulamalar > VideoIndir (ya da Kaldir.bat).'
  if (-not $NoLaunch) { Start-Process $exe }
}
catch {
  Write-Host ''
  Write-Host ('HATA: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
