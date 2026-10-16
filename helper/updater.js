// Uygulamanın kendi güncellemesi: GitHub'daki sürümleri denetler, yenilikleri özetler, güncelleyiciyi (Guncelle.ps1) başlatır.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'emiraneren/VideoIndir';
const APP_ROOT = path.join(__dirname, '..'); // kurulu "dosyalar" klasörü (ya da düz yerleşimde kurulum klasörü)

function currentVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'extension', 'manifest.json'), 'utf8').replace(/^﻿/, '')).version; } catch { return '0.0.0'; }
}

// Geliştirme klasörü (git deposu) kendini güncellemez: yamanın üstüne yazıp çalışma dosyalarını bozmasın
const isDevFolder = () => fs.existsSync(path.join(APP_ROOT, '.git'));

const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

const cleanLine = (l) => l
  .replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]/g, '')
  .trim();

// Sürüm notundan "Yenilikler" bölümündeki maddeleri çıkarır (başlık yoksa tüm maddeleri alır)
function notesOf(body) {
  const lines = String(body || '').split(/\r?\n/);
  let from = lines.findIndex((l) => /^#+\s*.*yenilik/i.test(l));
  let part = lines;
  if (from >= 0) {
    part = lines.slice(from + 1);
    const stop = part.findIndex((l) => /^#+\s/.test(l));
    if (stop >= 0) part = part.slice(0, stop);
  }
  let items = part.filter((l) => /^\s*(?:[-*•]|\d+\.)\s+/.test(l)).map(cleanLine).filter(Boolean);
  if (!items.length) items = part.filter((l) => l.trim() && !/^#/.test(l)).map(cleanLine).filter(Boolean).slice(0, 8);
  return items.slice(0, 12);
}

async function check() {
  const current = currentVersion();
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { 'User-Agent': 'VideoIndir', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(12000),
    });
  } catch { throw new Error('İnternete bağlanılamadı. Bağlantını kontrol edip tekrar dene.'); }
  if (res.status === 403 || res.status === 429) throw new Error('GitHub şu an çok fazla istek aldı. Biraz sonra tekrar dene.');
  if (!res.ok) throw new Error('Güncelleme bilgisi alınamadı. Biraz sonra tekrar dene.');
  const list = (await res.json()).filter((r) => !r.draft && !r.prerelease && r.tag_name);
  const newer = list.filter((r) => compare(r.tag_name, current) > 0).sort((a, b) => compare(b.tag_name, a.tag_name));
  return {
    current,
    available: newer.length > 0,
    latest: newer.length ? newer[0].tag_name.replace(/^v/i, '') : current,
    canPatch: newer.length > 0 && newer[0].assets.some((a) => /^VideoIndir-yama-.*\.zip$/.test(a.name)),
    url: newer.length ? newer[0].html_url : `https://github.com/${REPO}/releases/latest`,
    dev: isDevFolder(),
    releases: newer.map((r) => ({ version: r.tag_name.replace(/^v/i, ''), notes: notesOf(r.body), url: r.html_url })),
  };
}

// Güncelleyiciyi başlatır: uygulamayı kapatır, yamayı uygular, yeniden açar. Bu işlem (servis) de kapanır.
function apply() {
  if (isDevFolder()) return { ok: false, error: 'Bu bir geliştirme klasörü; kendini güncellemez.' };
  const script = path.join(APP_ROOT, 'Guncelle.ps1');
  if (!fs.existsSync(script)) return { ok: false, error: 'Güncelleyici (Guncelle.ps1) bulunamadı. Yeni zip dosyasını GitHub\'dan indir.' };
  setTimeout(() => {
    // Güncelleyici bu servisi kapatacak. Node, doğrudan alt süreçleri ana süreçle birlikte öldürür (detached ise PowerShell'i
    // başlatamıyor); bu yüzden onu bir "torun" süreç olarak başlatıyoruz: Start-Process ile açılan süreç ana süreçten bağımsız yaşar.
    const q = (s) => s.replace(/'/g, "''");
    const launcher = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"${q(script)}"','-Yes','-Quiet')`;
    spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', launcher], { stdio: 'ignore', windowsHide: true }).unref();
  }, 600);
  return { ok: true };
}

module.exports = { check, apply, currentVersion, isDevFolder, notesOf, compare };
