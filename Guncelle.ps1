# VideoIndir güncelleyici: GitHub'daki sürümleri denetler, yenilikleri özetler, yeni sürüm varsa yamayı indirip uygular.
# Normalde uygulamanın içinden (Ayarlar > Güncellemeleri denetle) çalışır. Elle: Guncelle.bat'a çift tıkla.
# Seçenekler: -Yes sormadan onayla, -Quiet pencere açma (uygulama başlatır), -NoLaunch sonra uygulamayı açma, -Root başka bir kurulumu güncelle
param(
  [switch]$Yes,
  [switch]$Quiet,
  [switch]$NoLaunch,
  [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}   # konsolsuz (gizli) çalışırken hata vermesin
if ($Quiet) { try { Start-Transcript -Path (Join-Path $env:TEMP "videoindir-guncelle.log") -Force | Out-Null } catch {} }   # gizli çalışırken ne olduğunu kaydet
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'emiraneren/VideoIndir'

function Info($m) { if (-not $Quiet) { Write-Host $m } }
function Good($m) { if (-not $Quiet) { Write-Host $m -ForegroundColor Green } }
function Warn($m) { if (-not $Quiet) { Write-Host $m -ForegroundColor Yellow } }

# Kurulum klasörü: bu script "app" klasöründeyse bir üst klasör (VideoIndir.exe orada), değilse script'in klasörü
if (-not $Root) {
  $Root = $PSScriptRoot
  if (@('app', 'dosyalar') -contains (Split-Path $PSScriptRoot -Leaf)) { $Root = Split-Path $PSScriptRoot -Parent }
}
# Düzen: yeni pakette uygulama dosyaları "app" (v1.0.11'de "dosyalar") altında, eski (düz) kurulumlarda doğrudan kurulum klasöründe
$appName = @('app', 'dosyalar') | Where-Object { Test-Path (Join-Path $Root "$_\extension\manifest.json") } | Select-Object -First 1
$nested = [bool]$appName
$app = if ($nested) { Join-Path $Root $appName } else { $Root }

# Sürüm notundan "Yenilikler" maddelerini çıkarır
function Get-Notes($body) {
  $lines = @(([string]$body) -split "`r?`n")
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '(?i)^#+\s*.*yenilik') { $start = $i; break } }
  $part = $lines
  if ($start -ge 0) {
    $part = @($lines[($start + 1)..($lines.Count - 1)])
    for ($j = 0; $j -lt $part.Count; $j++) { if ($part[$j] -match '^#+\s') { $part = @($part[0..($j - 1)]); break } }
  }
  @($part | Where-Object { $_ -match '^\s*[-*]\s+' } | ForEach-Object { ($_ -replace '^\s*[-*]\s+', '') -replace '\[([^\]]+)\]\([^)]*\)', '$1' -replace '[*_`]', '' } | Select-Object -First 12)
}

# Hata olursa pencere kapalıyken (-Quiet) kullanıcı bir şey görsün
function Show-Error($text) {
  if ($Quiet) {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show($text, 'VideoIndir güncelleme', 'OK', 'Error')
  } else {
    Write-Host ''
    Write-Host ("HATA: " + $text) -ForegroundColor Red
  }
}

$stopped = $false
try {
  $manifest = Join-Path $app 'extension\manifest.json'
  if (-not (Test-Path $manifest)) { throw "VideoIndir klasörü bulunamadı: $Root" }
  # Sürüm numarası eklentinin manifest dosyasından okunur (her sürümde güncellenir)
  $current = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
  Info "Kurulu sürüm : $current"
  Info "GitHub'daki sürümler denetleniyor..."

  $rels = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=20" -Headers @{ 'User-Agent' = 'VideoIndir-Guncelle' } -TimeoutSec 30
  $newer = @($rels | Where-Object { -not $_.draft -and -not $_.prerelease -and ([version]($_.tag_name.TrimStart('v'))) -gt [version]$current } |
    Sort-Object { [version]($_.tag_name.TrimStart('v')) } -Descending)
  if ($newer.Count -eq 0) { Good 'Zaten güncelsin. Yapılacak bir şey yok.'; return }

  $rel = $newer[0]
  $latest = $rel.tag_name.TrimStart('v')
  Info "Son sürüm    : $latest"
  Info ''
  Info 'Yenilikler:'
  foreach ($r in $newer) {
    Info ("  Sürüm " + $r.tag_name.TrimStart('v') + ":")
    $notes = Get-Notes $r.body
    if ($notes.Count -eq 0) { Info '    - Küçük düzeltmeler ve iyileştirmeler.' } else { foreach ($n in $notes) { Info "    - $n" } }
  }
  Info ''

  $asset = $rel.assets | Where-Object { $_.name -like 'VideoIndir-yama-*.zip' } | Select-Object -First 1
  if (-not $asset) { throw "Bu sürümde yama dosyası yok. Tam zip dosyasını buradan indir: $($rel.html_url)" }
  # Yalnızca bu deponun release adresinden indir
  if ($asset.browser_download_url -notlike "https://github.com/$repo/releases/download/*") { throw 'Beklenmeyen indirme adresi, işlem durduruldu.' }

  Info ("Yama        : {0} ({1:N0} KB)" -f $asset.name, ($asset.size / 1KB))
  if (-not $Yes) {
    $ans = Read-Host "Güncellensin mi? ($current -> $latest). VideoIndir kapatılıp yeniden açılacak. [E/H]"
    if ($ans -notmatch '^[eEyY]') { Warn 'İptal edildi.'; return }
  }

  # Önce yamayı indir ve doğrula; uygulamayı ancak bundan sonra kapat (indirme başarısız olursa çalışan uygulamaya dokunulmaz)
  Info 'Yama indiriliyor...'
  $zip = Join-Path $env:TEMP ("videoindir-yama-$latest.zip")
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 120

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  $hasManifest = @($z.Entries | Where-Object { $_.FullName -eq 'extension/manifest.json' }).Count -gt 0
  $z.Dispose()
  if (-not $hasManifest) { throw 'İndirilen dosya geçerli bir VideoIndir yaması değil.' }

  # Çalışan VideoIndir'i ve servisini kapat (yalnızca bu klasördekini)
  $rootFull = (Resolve-Path $Root).Path
  $stopped = $true
  Get-Process VideoIndir -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
  $listener = Get-NetTCPConnection -LocalPort 9696 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node' -and $proc.Path -and $proc.Path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $proc.Id -Force }   # /T kullanılmaz: bu script servisin alt süreci olabilir
  }
  Get-Process yt-dlp, ffmpeg -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  Info 'Yama uygulanıyor...'
  if ($nested) {
    # Yeni düzen: VideoIndir.exe kurulum klasörüne, geri kalan her şey "app" altına
    $tmp = Join-Path $env:TEMP ("videoindir-yama-$latest")
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    foreach ($item in Get-ChildItem $tmp) {
      $dest = if ($item.Name -eq 'VideoIndir.exe') { $Root } else { $app }
      Copy-Item -LiteralPath $item.FullName -Destination $dest -Recurse -Force
    }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Expand-Archive -LiteralPath $zip -DestinationPath $Root -Force
  }
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

  $now = (Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
  # Windows "Uygulamalar" listesindeki sürüm numarasını da güncelle (Kur.bat ile kurulduysa)
  try { Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VideoIndir' -Name DisplayVersion -Value $now -ErrorAction Stop } catch {}
  Good "Güncellendi: $current -> $now"
  $stopped = $false

  if (-not $NoLaunch) {
    $exe = Join-Path $Root 'VideoIndir.exe'
    if (Test-Path $exe) { Info 'VideoIndir yeniden açılıyor...'; Start-Process $exe }
  }
}
catch {
  Show-Error ($_.Exception.Message + "`nGüncelleme tamamlanamadı. İnternet bağlantını kontrol edip tekrar dene ya da yeni zip dosyasını GitHub'dan elle indir.")
  # Uygulama kapatıldıysa ama güncelleme yarım kaldıysa, eski haliyle yeniden aç
  if ($stopped -and -not $NoLaunch) { $exe = Join-Path $Root 'VideoIndir.exe'; if (Test-Path $exe) { Start-Process $exe } }
  exit 1
}
