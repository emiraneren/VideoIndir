# VideoIndir güncelleyici: GitHub'daki en son sürümü denetler; kurulu sürümden farklıysa yamayı indirip uygular.
# Kullanım: Guncelle.bat'a çift tıkla. (İsteğe bağlı: -Yes sormadan onayla, -NoLaunch sonra uygulamayı açma, -Root başka bir klasörü güncelle)
param(
  [switch]$Yes,
  [switch]$NoLaunch,
  [string]$Root = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'emiraneren/VideoIndir'

function Info($m) { Write-Host $m }
function Good($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

try {
  $manifest = Join-Path $Root 'extension\manifest.json'
  if (-not (Test-Path $manifest)) { throw "VideoIndir klasörü bulunamadı: $Root" }
  # Sürüm numarası eklentinin manifest dosyasından okunur (her sürümde güncellenir)
  $current = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Info "Kurulu sürüm : $current"
  Info "GitHub'daki son sürüm denetleniyor..."

  $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'VideoIndir-Guncelle' } -TimeoutSec 30
  $latest = $rel.tag_name.TrimStart('v')
  Info "Son sürüm    : $latest"

  if ($latest -eq $current) { Good 'Zaten güncelsin. Yapılacak bir şey yok.'; return }

  $asset = $rel.assets | Where-Object { $_.name -like 'VideoIndir-yama-*.zip' } | Select-Object -First 1
  if (-not $asset) { throw "Bu sürümde yama dosyası yok. Tam zip dosyasını buradan indir: $($rel.html_url)" }
  # Yalnızca bu deponun release adresinden indir
  if ($asset.browser_download_url -notlike "https://github.com/$repo/releases/download/*") { throw 'Beklenmeyen indirme adresi, işlem durduruldu.' }

  Info ("Yama        : {0} ({1:N0} KB)" -f $asset.name, ($asset.size / 1KB))
  if (-not $Yes) {
    $ans = Read-Host "Güncellensin mi? ($current -> $latest). VideoIndir kapatılıp yeniden açılacak. [E/H]"
    if ($ans -notmatch '^[eEyY]') { Warn 'İptal edildi.'; return }
  }

  # Çalışan VideoIndir'i ve servisini kapat (yalnızca bu klasördekini)
  $rootFull = (Resolve-Path $Root).Path
  Get-Process VideoIndir -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
  $listener = Get-NetTCPConnection -LocalPort 9696 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node' -and $proc.Path -and $proc.Path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $proc.Id -Force }
  }
  Start-Sleep -Seconds 1

  Info 'Yama indiriliyor...'
  $zip = Join-Path $env:TEMP ("videoindir-yama-$latest.zip")
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 120

  # Zip gerçekten bir VideoIndir yaması mı (beklenen dosya var mı)?
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  $hasManifest = @($z.Entries | Where-Object { $_.FullName -eq 'extension/manifest.json' }).Count -gt 0
  $z.Dispose()
  if (-not $hasManifest) { throw 'İndirilen dosya geçerli bir VideoIndir yaması değil.' }

  Info 'Yama uygulanıyor...'
  Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

  $now = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Good "Güncellendi: $current -> $now"

  if (-not $NoLaunch) {
    $exe = Join-Path $Root 'VideoIndir.exe'
    if (Test-Path $exe) { Info 'VideoIndir yeniden açılıyor...'; Start-Process $exe }
  }
}
catch {
  Write-Host ''
  Write-Host ("HATA: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Güncelleme tamamlanamadı. İnternet bağlantını kontrol edip tekrar dene ya da yeni zip dosyasını elle indir.'
  exit 1
}
