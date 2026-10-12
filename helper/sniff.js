// Eklentisiz akış yakalama: sayfayı Edge/Chrome'un ayrı, izole bir penceresinde açar ve tarayıcının hata ayıklama
// protokolüyle (Chrome DevTools Protocol, CDP) ağ trafiğini dinler. Kullanıcı videoyu o pencerede oynatınca
// m3u8/mpd/mp4 akışları ve sayfadaki <video>/oynatıcı bilgileri yakalanır. Yalnızca yerel kullanımda açıktır.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PROFILE_DIR = path.join(__dirname, 'sniff-profile'); // ayrı profil: girişler burada hatırlanır, kullanıcının asıl profiline dokunulmaz
const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i;
const FILE_RE = /\.(mp4|webm|m4v|mov|mkv|mp3|m4a|flv|ogg|opus|wav)(\?|#|$)/i;
// Parça (segment) dosyaları tek başına anlamsızdır
const SEGMENT_RE = /\.(ts|m4s|cmfv|cmfa|aac)(\?|#|$)|[-_/](seg|segment|chunk|frag|fragment)[-_]?\d+|[?&](range|bytestart|sq|rn)=/i;
const SKIP_HOST_RE = /googlevideo\.com$/i;
const MIN_FILE_BYTES = 300000;
const MAX_CANDIDATES = 40;
// Pencerede yapılan girişlerin çerezleri (Facebook, Instagram...) yt-dlp için buraya yazılır. Yalnızca yerel kullanımda okunur.
const COOKIE_FILE = path.join(__dirname, 'sniff-cookies.txt');

// Sayfada çalıştırılacak tarama kodu: eklentideki fonksiyonların aynısı (tek kaynak, kopya yok)
function extractFns() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'popup.js'), 'utf8');
    const a = src.indexOf('function scanPage() {');
    const b = src.indexOf('function scanPlayers() {');
    const c = src.indexOf('// Son çare');
    if (a < 0 || b < a || c < b) return null;
    return { scanPage: src.slice(a, b), scanPlayers: src.slice(b, c) };
  } catch { return null; }
}
const FNS = extractFns();

const PLAY_EXPR = `(() => { try { document.querySelectorAll('video').forEach((v) => { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); }); } catch (e) {} })()`;

function findBrowser() {
  const pf = process.env.ProgramFiles, pf86 = process.env['ProgramFiles(x86)'], local = process.env.LOCALAPPDATA;
  const list = [
    pf86 && path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    pf && path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    pf && path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    pf86 && path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
    pf && path.join(pf, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
  ].filter(Boolean);
  return list.find((p) => fs.existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Çok küçük bir CDP istemcisi (Node'un yerleşik WebSocket'i ile)
class Cdp {
  constructor(ws, onEvent) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result || {});
      } else if (m.method) onEvent(m);
    };
  }
  send(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('CDP zaman aşımı: ' + method)); }, 8000);
    });
  }
}

const dedupeKey = (url) => {
  try { const u = new URL(url); return MANIFEST_RE.test(url) || FILE_RE.test(url) ? u.origin + u.pathname : url; } catch { return url; }
};

class Sniffer {
  constructor(pageUrl) {
    this.id = crypto.randomBytes(12).toString('hex');
    this.pageUrl = pageUrl;
    this.title = '';
    this.status = 'starting'; // starting | open | closed | error
    this.error = null;
    this.candidates = new Map();
    this.sessions = new Map(); // sessionId -> {type}
    this.proc = null; this.cdp = null; this.timer = 0; this.cookieTimer = 0; this.mainSession = null; this.mainTarget = null;
    this.lastCookies = null; this.cookieVersion = 0; this.cookieCount = 0;
    this.createdAt = Date.now();
  }

  async start() {
    const exe = findBrowser();
    if (!exe) throw Object.assign(new Error('no browser'), { friendly: 'Edge veya Chrome bulunamadı.' });
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const portFile = path.join(PROFILE_DIR, 'DevToolsActivePort');
    fs.rmSync(portFile, { force: true });

    this.proc = spawn(exe, [
      '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--window-size=1100,820', 'about:blank',
    ], { stdio: 'ignore' });
    this.proc.on('exit', () => this.close());
    this.proc.on('error', (e) => { this.error = e.message; this.close(); });

    let port, wsPath;
    for (let i = 0; i < 150 && !port; i++) { // en çok 15 sn
      await sleep(100);
      if (this.status === 'closed') break;
      try { [port, wsPath] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/); } catch {}
    }
    if (!port) { this.close(); throw Object.assign(new Error('no cdp'), { friendly: 'Tarayıcı penceresi başlatılamadı.' }); }

    const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    ws.onclose = () => this.close();
    this.cdp = new Cdp(ws, (m) => this.onEvent(m));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true }); // açık sayfalar için targetCreated olayları gelir
    for (let i = 0; i < 100 && !this.mainSession; i++) await sleep(100); // ilk sayfa bağlanıp yönlendirilene kadar bekle
    if (!this.mainSession) { this.close(); throw Object.assign(new Error('no page'), { friendly: 'Tarayıcı sayfası bulunamadı.' }); }
    this.status = 'open';
    this.timer = setInterval(() => this.scanDom(), 3000);
    this.cookieTimer = setInterval(() => this.exportCookies(), 1500); // pencere hemen kapatılsa bile son giriş kaybolmasın
    this.exportCookies();
    setTimeout(() => this.tryPlay(), 5000);
  }

  async initSession(sessionId, type) {
    this.sessions.set(sessionId, { type });
    const s = (m, p) => this.cdp.send(m, p, sessionId).catch(() => {});
    await s('Network.enable', {});
    await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); // iframe'ler ayrı oturum olarak gelir
  }

  async onEvent(m) {
    try {
      const p = m.params || {};
      switch (m.method) {
        case 'Target.targetCreated':
          if (p.targetInfo.type === 'page') {
            const url = p.targetInfo.url || '';
            if (/^(edge|chrome|devtools|chrome-extension|chrome-untrusted):/i.test(url)) break; // tarayıcının kendi iç sayfaları (senkronizasyon, hoş geldin...)
            const isMain = !this.mainSession && url === 'about:blank'; // açılışta verdiğimiz boş sekme
            const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: p.targetInfo.targetId, flatten: true });
            await this.initSession(sessionId, 'page');
            if (isMain) {
              this.mainSession = sessionId;
              this.mainTarget = p.targetInfo.targetId;
              await this.cdp.send('Page.navigate', { url: this.pageUrl }, sessionId); // ağ dinlemesi açıkken yönlendir: ilk istekler kaçmasın
            }
          }
          break;
        case 'Target.attachedToTarget': // iframe/oturum otomatik bağlandı
          if (['iframe', 'page'].includes(p.targetInfo.type)) await this.initSession(p.sessionId, p.targetInfo.type);
          break;
        case 'Target.targetInfoChanged':
          // Başlık yalnızca bizim açtığımız sayfadan alınır (diğer sekmeler/iç sayfalar başlığı bozmasın)
          // Sayfa yüklenirken tarayıcı başlık olarak adresin kendisini bildirir; onu gerçek başlık sayma
          if (p.targetInfo.targetId === this.mainTarget && p.targetInfo.title && !/^about:blank$/.test(p.targetInfo.url)
              && p.targetInfo.title !== (p.targetInfo.url || '').replace(/^https?:\/\//, '')) {
            this.title = p.targetInfo.title;
            this.pageUrl = p.targetInfo.url || this.pageUrl;
          }
          break;
        case 'Network.requestWillBeSent': {
          const url = p.request && p.request.url;
          if (url && /^https?:/.test(url) && (MANIFEST_RE.test(url) || FILE_RE.test(url)) && !SEGMENT_RE.test(url)) {
            const h = p.request.headers || {};
            this.add(url, 'net', h.Referer || h.referer || p.documentURL);
          }
          break;
        }
        case 'Network.responseReceived': {
          const r = p.response;
          if (!r || !/^https?:/.test(r.url) || r.status >= 400 || SEGMENT_RE.test(r.url)) break;
          const mime = (r.mimeType || '').toLowerCase();
          const manifest = /mpegurl|dash\+xml/.test(mime);
          const media = /^(video|audio)\//.test(mime);
          if (!manifest && !media) break;
          const len = parseInt((r.headers && (r.headers['content-length'] || r.headers['Content-Length'])) || '0', 10) || 0;
          if (media && len && len < MIN_FILE_BYTES) break;
          const h = (p.requestHeaders) || {};
          this.add(r.url, 'net', h.Referer || h.referer, mime);
          break;
        }
      }
    } catch {}
  }

  add(url, kind, ref, mime) {
    let host = '';
    try { host = new URL(url).hostname; } catch { return; }
    if (SKIP_HOST_RE.test(host)) return;
    const k = dedupeKey(url);
    const prev = this.candidates.get(k);
    if (prev) { prev.url = url; if (ref && !prev.ref) prev.ref = ref; return; }
    if (this.candidates.size >= MAX_CANDIDATES) return;
    this.candidates.set(k, { url, kind, ref: ref || undefined, mime: mime || undefined, at: Date.now() });
  }

  // Sayfa/iframe içindeki <video>, meta, JSON-LD, oynatıcı verileri (eklentiyle aynı kod)
  // Tarayıcıdaki çerezleri (giriş oturumları dahil) yt-dlp'nin okuyacağı Netscape biçiminde dosyaya yazar.
  // Böylece giriş isteyen videolar (Facebook reel, Instagram...) sayfada bir kez giriş yapınca çözülebilir.
  async exportCookies() {
    if (!this.cdp || this.status !== 'open') return;
    try {
      const r = await this.cdp.send('Storage.getCookies', {});
      const clean = (s) => String(s).replace(/[\t\r\n]/g, '');
      const lines = (r.cookies || []).map((c) => [
        (c.httpOnly ? '#HttpOnly_' : '') + clean(c.domain),
        c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        clean(c.path),
        c.secure ? 'TRUE' : 'FALSE',
        c.session || !c.expires || c.expires <= 0 ? 0 : Math.floor(c.expires),
        clean(c.name),
        clean(c.value),
      ].join('\t'));
      const text = lines.join('\n');
      if (text === this.lastCookies) return;
      this.lastCookies = text;
      this.cookieCount = lines.length;
      this.cookieVersion++;
      const tmp = COOKIE_FILE + '.tmp';
      fs.writeFileSync(tmp, lines.length ? '# Netscape HTTP Cookie File\n' + text + '\n' : '', { mode: 0o600 });
      fs.renameSync(tmp, COOKIE_FILE);
    } catch {}
  }

  async scanDom() {
    if (this.status !== 'open') return;
    // Başlığı doğrudan sayfadan oku: tarayıcı başlık değişikliğini hedef olaylarıyla her zaman bildirmez
    if (this.mainSession) {
      try {
        const t = await this.cdp.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, this.mainSession);
        const title = t.result && t.result.value;
        if (title && typeof title === 'string') this.title = title;
      } catch {}
    }
    if (!FNS) return;
    for (const [sessionId] of this.sessions) {
      try {
        const page = await this.cdp.send('Runtime.evaluate', { expression: `(${FNS.scanPage})()`, returnByValue: true }, sessionId);
        const items = (page.result && page.result.value && page.result.value.items) || [];
        items.forEach((i) => this.add(i.url, i.kind, i.ref));
        const pl = await this.cdp.send('Runtime.evaluate', { expression: `(${FNS.scanPlayers})()`, returnByValue: true }, sessionId);
        ((pl.result && pl.result.value) || []).forEach((u) => this.add(u, 'hook'));
      } catch {}
    }
  }

  // Oynat tuşuna basılmadan başlayabilen (sessiz) videoları başlat; çoğu site yine de kullanıcı tıklaması ister
  async tryPlay() {
    if (this.status !== 'open') return;
    for (const [sessionId] of this.sessions) this.cdp.send('Runtime.evaluate', { expression: PLAY_EXPR }, sessionId).catch(() => {});
  }

  snapshot() {
    return {
      id: this.id, status: this.status, title: this.title, pageUrl: this.pageUrl, error: this.error,
      cookieVersion: this.cookieVersion, cookieCount: this.cookieCount, // çerezler değişince arayüz sayfa adresini yeniden çözer
      candidates: [...this.candidates.values()].map(({ url, kind, ref, mime }) => ({ url, kind, ref, mime })),
    };
  }

  close() {
    if (this.status === 'closed') return;
    this.status = 'closed';
    clearInterval(this.timer);
    clearInterval(this.cookieTimer);
    try { this.cdp && this.cdp.ws.close(); } catch {}
    if (this.proc && this.proc.exitCode === null) {
      // pencereyi (ve alt süreçlerini) kapat; profil klasörü kalır
      spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
  }
}

module.exports = { Sniffer, findBrowser, COOKIE_FILE };
