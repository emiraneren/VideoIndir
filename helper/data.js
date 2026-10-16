// Kalıcı veriler: ayarlar, indirme geçmişi ve (tepsi bildirimleri için) olay kuyruğu.
// Uygulama klasörünün DIŞINDA (%APPDATA%\VideoIndir) tutulur: güncellemeler ayarları/geçmişi silmez.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.VI_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'VideoIndir');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const DEFAULT_DIR = path.join(os.homedir(), 'Downloads', 'VideoIndir');
const HISTORY_MAX = 200;

const DEFAULTS = {
  downloadDir: DEFAULT_DIR,
  maxParallel: 3,          // aynı anda en fazla kaç indirme; fazlası sıraya girer
  autoUpdateYtdlp: true,   // indirme aracı (yt-dlp) günde bir kendiliğinden güncellensin
  notify: true,            // indirme bitince tepsi bildirimi
  lastYtdlpCheck: 0,
  checkAppUpdate: true,    // yeni VideoIndir sürümü çıkınca tepsiden haber ver
  lastNotifiedVersion: '', // hangi sürüm için haber verildi (aynı sürüm için tekrar etme)
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

// ---------- ayarlar ----------
let settings = { ...DEFAULTS };
(function load() {
  const s = readJson(SETTINGS_FILE, {});
  if (typeof s.downloadDir === 'string' && path.isAbsolute(s.downloadDir)) settings.downloadDir = s.downloadDir;
  if (Number.isInteger(s.maxParallel)) settings.maxParallel = Math.min(6, Math.max(1, s.maxParallel));
  for (const k of ['autoUpdateYtdlp', 'notify', 'checkAppUpdate']) if (typeof s[k] === 'boolean') settings[k] = s[k];
  if (typeof s.lastNotifiedVersion === 'string') settings.lastNotifiedVersion = s.lastNotifiedVersion;
  if (Number.isFinite(s.lastYtdlpCheck)) settings.lastYtdlpCheck = s.lastYtdlpCheck;
})();

const getSettings = () => ({ ...settings });

// patch'i doğrular ve kaydeder. Dönüş: {ok:true, settings} ya da {ok:false, error}
function setSettings(patch) {
  const next = { ...settings };
  if (patch.downloadDir !== undefined) {
    const dir = String(patch.downloadDir || '').trim();
    if (!path.isAbsolute(dir)) return { ok: false, error: 'Geçerli bir klasör yolu yaz (örnek: C:\\Videolar).' };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.videoindir-yazma-testi-${process.pid}`);
      fs.writeFileSync(probe, 'x');
      fs.rmSync(probe, { force: true });
    } catch { return { ok: false, error: 'Bu klasöre dosya yazılamıyor. Başka bir klasör seç.' }; }
    next.downloadDir = dir;
  }
  if (patch.maxParallel !== undefined) {
    const n = parseInt(patch.maxParallel, 10);
    if (!Number.isInteger(n) || n < 1 || n > 6) return { ok: false, error: 'Aynı anda indirme sayısı 1 ile 6 arasında olmalı.' };
    next.maxParallel = n;
  }
  for (const k of ['autoUpdateYtdlp', 'notify', 'checkAppUpdate']) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  if (typeof patch.lastNotifiedVersion === 'string') next.lastNotifiedVersion = patch.lastNotifiedVersion.slice(0, 32);
  if (Number.isFinite(patch.lastYtdlpCheck)) next.lastYtdlpCheck = patch.lastYtdlpCheck;
  settings = next;
  writeJson(SETTINGS_FILE, settings);
  return { ok: true, settings: getSettings() };
}

// ---------- geçmiş ----------
let history = readJson(HISTORY_FILE, []);
if (!Array.isArray(history)) history = [];

function addHistory({ title, file, size, mode, height, url }) {
  const entry = { id: crypto.randomBytes(6).toString('hex'), title: title || path.basename(file || ''), file, size: size || 0, mode, height: height || null, url, at: Date.now() };
  history.unshift(entry);
  history = history.slice(0, HISTORY_MAX);
  writeJson(HISTORY_FILE, history);
  return entry;
}
// exists: dosya hâlâ yerinde mi (kullanıcı silmiş/taşımış olabilir)
const listHistory = () => history.map((h) => ({ ...h, exists: !!h.file && fs.existsSync(h.file) }));
const findHistory = (id) => history.find((h) => h.id === id) || null;
function removeHistory(id) { const n = history.length; history = history.filter((h) => h.id !== id); if (history.length !== n) writeJson(HISTORY_FILE, history); return history.length !== n; }
function clearHistory() { history = []; writeJson(HISTORY_FILE, history); }

// ---------- olaylar (tepsi bildirimi için) ----------
// Uygulama (exe) bunu yoklar; bitmiş/hatalı indirmelerde tepsi balonu gösterir. Bellekte, kısa ömürlü.
const events = [];
let seq = 0;
function pushEvent(e) { events.push({ seq: ++seq, at: Date.now(), ...e }); while (events.length > 50) events.shift(); }
const eventsAfter = (n) => events.filter((e) => e.seq > n);
const lastSeq = () => seq;

module.exports = {
  DATA_DIR, DEFAULT_DIR, getSettings, setSettings,
  addHistory, listHistory, findHistory, removeHistory, clearHistory,
  pushEvent, eventsAfter, lastSeq,
};
