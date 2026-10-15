// VideoIndir web sitesi katmanı: statik sayfa + /api/* uçları.
// Akış: /api/resolve (bağlantıyı çöz, formatları listele) → /api/start (indirmeyi başlat) → /api/job/:id (ilerleme) → /api/file/:id (dosyayı tarayıcıya ver).
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const { Sniffer, COOKIE_FILE: SNIFF_COOKIES } = require('./sniff');

const WEB_DIR = path.join(__dirname, 'web');
const COOKIES_TXT = path.join(__dirname, 'cookies.txt'); // isteğe bağlı: Facebook/Instagram gibi giriş isteyen siteler için sunucu tarafı çerezler
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

// Yerel/özel ağ adresleri: herkese açık modda yt-dlp'nin sunucunun iç ağına yönlendirilmesini (SSRF) engeller
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

async function assertPublicTarget(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error('Adres çözülemedi'), { friendly: 'Bu adres bulunamadı. Bağlantıyı kontrol et.' });
  if (addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('private target'), { friendly: 'Bu adres desteklenmiyor.' });
}

// yt-dlp hatalarını kullanıcıya anlaşılır mesaja çevirir; ham mesajdaki dosya yolları temizlenir
function explain(msg) {
  const raw = String(msg || '').replace(/^ERROR:\s*/i, '').replace(/[A-Za-z]:\\[^\s'"]*/g, '…').slice(0, 220);
  const rules = [
    [/not a bot|confirm you.re not a robot|sign in to confirm/i, 'Bu site sunucuyu bot sanıp doğrulama istiyor. YouTube bunu sunucu adreslerine sık yapar; çerez eklenmedikçe indirilemeyebilir.'],
    [/private video|members.only|login|log in|sign in|cookies|authenticat|age.?restrict|confirm your age|requires? (a )?(account|subscription)/i, 'Bu video özel ya da giriş gerektiriyor. Sunucuya çerez eklenmedikçe indirilemez.'],
    // Facebook/Instagram gibi sitelerde giriş duvarı çoğu zaman "Cannot parse data" olarak görünür
    [/cannot parse data|empty media response|rate-limit reached|checkpoint|http error 403|forbidden/i,'Bu video giriş gerektiriyor olabilir. "Çözülmüyor mu? Sayfayı açıp videoyu bul"a bas, açılan pencerede siteye bir kez giriş yap; uygulama otomatik devam eder.'],
    [/unsupported url|no video|no suitable|unable to extract/i,'Bu bağlantıdan video çıkarılamadı. Doğrudan bir video/gönderi sayfasının adresini yapıştır.'],
    [/unavailable|removed|deleted|not available|copyright|geo|country|does not exist|404/i, 'Video mevcut değil, kaldırılmış ya da bu bölgede kullanılamıyor.'],
    [/zaman aşımı|timed? ?out/i, 'Site zamanında cevap vermedi. Biraz sonra tekrar dene.'],
    [/larger than max-filesize|max.filesize/i, 'Dosya izin verilen boyut sınırından büyük. Daha düşük bir kalite seç.'],
    [/ffmpeg|conversion failed|postprocess/i, 'Video indirildi ama dosya işlenirken hata oluştu.'],
  ];
  const hit = rules.find(([re]) => re.test(msg));
  return { error: hit ? hit[1] : 'Video çözülemedi.', detail: raw };
}

function createWeb({ PUBLIC, WORK_DIR, info, startJob, cancelJob, pauseJob, resumeJob, jobs, ACTIVE, send, readBody, validUrl }) {
  const MAX_DURATION = parseInt(process.env.VI_MAX_DURATION || String(4 * 3600), 10); // saniye
  const MAX_WEB_JOBS = parseInt(process.env.VI_MAX_JOBS || (PUBLIC ? '3' : '6'), 10);
  const TTL_MS = 30 * 60 * 1000;                     // bitmiş dosyalar 30 dk sonra silinir
  const TRUST_PROXY = process.env.VI_TRUST_PROXY === '1';

  const sniffers = new Map(); // akış yakalama oturumları
  const hits = new Map(); // ip|kova -> zaman damgaları (kayan pencere hız sınırı; yalnızca herkese açık modda)
  const allow = (ip, bucket, limit, windowMs) => {
    if (!PUBLIC) return true;
    const k = `${ip}|${bucket}`, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { hits.set(k, arr); return false; }
    arr.push(now); hits.set(k, arr);
    return true;
  };
  // Vekil arkasında: Cloudflare CF-Connecting-IP'yi kendisi yazar; yoksa X-Forwarded-For'un SON girdisi (vekilin eklediği) kullanılır
  const clientIp = (req) => {
    if (TRUST_PROXY) {
      const cf = String(req.headers['cf-connecting-ip'] || '').trim();
      if (cf) return cf;
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '?';
  };

  // Çerezler: elle konan cookies.txt + (yalnızca yerel kullanımda) "videoyu bul" penceresinde yapılan girişlerin çerezleri.
  // Herkese açık modda pencere çerezleri ASLA kullanılmaz: yoksa kendi oturumun tüm ziyaretçilere açılırdı.
  const serverCookies = () => {
    const read = (f) => { try { const t = fs.readFileSync(f, 'utf8'); return t.length < 1.5e6 ? t : ''; } catch { return ''; } };
    let text = read(COOKIES_TXT);
    if (!PUBLIC) {
      const sniffed = read(SNIFF_COOKIES).replace(/^# Netscape HTTP Cookie File\r?\n/, '');
      if (sniffed.trim()) text = (text.trim() ? text.replace(/\n?$/, '\n') : '# Netscape HTTP Cookie File\n') + sniffed;
    }
    return text.trim() ? text : null;
  };

  // Başlangıçta eski geçici dosyaları temizle, sonra düzenli olarak süresi dolanları sil
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  setInterval(() => {
    const now = Date.now();
    for (const [id, j] of jobs) {
      // Duraklatılıp unutulan iş geçici dosyaları sonsuza dek tutmasın: 6 saat sonra iptal edilir
      if (j.web && j.status === 'paused' && now - (j.pausedAt || j.startedAt) > 6 * 3600e3) cancelJob(id);
      if (j.web && !ACTIVE.includes(j.status) && now - (j.finishedAt || j.startedAt) > TTL_MS) {
        fs.rm(path.join(WORK_DIR, id), { recursive: true, force: true }, () => {});
        jobs.delete(id);
      }
    }
    for (const [sid, s] of sniffers) if (s.status === 'closed' && now - s.createdAt > TTL_MS) sniffers.delete(sid);
    for (const [k, arr] of hits) { const f = arr.filter((t) => now - t < 3600e3); f.length ? hits.set(k, f) : hits.delete(k); }
  }, 5 * 60 * 1000).unref();

  const fail = (res, code, e) => send(res, code, e.friendly ? { error: e.friendly } : explain(e.message));

  // true döndürürse istek burada işlenmiştir
  return async function handle(req, res, u) {
    const p = u.pathname;

    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      res.writeHead(200, { 'Content-Type': type, ...SECURITY_HEADERS });
      res.end(fs.readFileSync(path.join(WEB_DIR, file)));
      return true;
    }
    if (!p.startsWith('/api/')) return false;
    const ip = clientIp(req);

    if (p === '/api/resolve' && req.method === 'POST') {
      if (!allow(ip, 'resolve', 20, 10 * 60e3)) return send(res, 429, { error: 'Çok fazla istek. Biraz bekleyip tekrar dene.' }), true;
      let url, referer;
      try {
        const b = await readBody(req);
        url = String(b.url || '').trim();
        referer = typeof b.referer === 'string' && validUrl(b.referer) ? b.referer : undefined;
      } catch { return send(res, 400, { error: 'Geçersiz istek.' }), true; }
      if (url.length > 2000 || !validUrl(url)) return send(res, 400, { error: 'Geçerli bir bağlantı yapıştır (http veya https ile başlamalı).' }), true;
      try {
        if (PUBLIC) await assertPublicTarget(url);
        const meta = await info(url, { cookies: serverCookies(), referer });
        if (meta.isLive) return send(res, 422, { error: 'Canlı yayınlar desteklenmiyor.' }), true;
        if (meta.duration > MAX_DURATION) return send(res, 422, { error: `Video çok uzun (en fazla ${Math.round(MAX_DURATION / 3600)} saat).` }), true;
        const { title, thumbnail, duration, uploader, options, mp3Size, profile } = meta;
        send(res, 200, { title, thumbnail, duration, uploader, options, mp3Size, profile, url });
      } catch (e) { fail(res, 422, e); }
      return true;
    }

    if (p === '/api/start' && req.method === 'POST') {
      if (!allow(ip, 'start', 10, 10 * 60e3)) return send(res, 429, { error: 'Çok fazla indirme isteği. Biraz bekleyip tekrar dene.' }), true;
      let b;
      try { b = await readBody(req); } catch { return send(res, 400, { error: 'Geçersiz istek.' }), true; }
      const url = String(b.url || '').trim();
      if (url.length > 2000 || !validUrl(url)) return send(res, 400, { error: 'Geçersiz bağlantı.' }), true;
      const height = Number.isInteger(b.height) && b.height > 0 && b.height <= 4320 ? b.height : null;
      const profile = Number.isInteger(b.profile) && b.profile >= 0 && b.profile <= 2 ? b.profile : 0;
      const active = [...jobs.values()].filter((j) => j.web && ACTIVE.includes(j.status)).length;
      if (active >= MAX_WEB_JOBS) return send(res, 429, { error: 'Sunucu şu an meşgul. Birkaç dakika sonra tekrar dene.' }), true;
      try {
        if (PUBLIC) await assertPublicTarget(url);
        // referer: akışı gerçekte isteyen sayfa · title: akış adreslerinde anlamlı dosya adı için sayfa başlığı
        const referer = typeof b.referer === 'string' && validUrl(b.referer) ? b.referer : undefined;
        const title = typeof b.title === 'string' ? b.title.slice(0, 200) : undefined;
        const job = startJob({ url, mode: b.kind === 'mp3' ? 'mp3' : 'video', height, profile, referer, title, cookies: serverCookies(), web: true });
        send(res, 200, { id: job.id });
      } catch (e) { fail(res, 422, e); }
      return true;
    }

    // --- İptal / duraklat / devam et
    const cm = p.match(/^\/api\/job\/([a-f0-9]{24})\/(cancel|pause|resume)$/);
    if (cm && req.method === 'POST') {
      const j = jobs.get(cm[1]);
      if (!j || !j.web) return send(res, 404, { error: 'İş bulunamadı.' }), true;
      const act = { cancel: cancelJob, pause: pauseJob, resume: resumeJob }[cm[2]];
      send(res, 200, { ok: act(cm[1]) });
      return true;
    }

    // --- Akış yakalama (eklentisiz): sayfayı ayrı bir tarayıcı penceresinde açıp ağ trafiğini dinler. Yalnızca yerel kullanımda.
    if (p === '/api/sniff/start' && req.method === 'POST') {
      if (PUBLIC) return send(res, 404, { error: 'yok' }), true;
      let url;
      try { url = String((await readBody(req)).url || '').trim(); } catch { return send(res, 400, { error: 'Geçersiz istek.' }), true; }
      if (url.length > 2000 || !validUrl(url)) return send(res, 400, { error: 'Geçerli bir sayfa adresi yapıştır.' }), true;
      for (const s of sniffers.values()) s.close(); // aynı anda tek pencere (ortak profil)
      const sn = new Sniffer(url);
      sniffers.set(sn.id, sn);
      try { await sn.start(); send(res, 200, { id: sn.id }); }
      catch (e) { sniffers.delete(sn.id); send(res, 422, { error: e.friendly || ('Pencere açılamadı: ' + e.message) }); }
      return true;
    }
    const sm = p.match(/^\/api\/sniff\/([a-f0-9]{24})(\/stop)?$/);
    if (sm && !PUBLIC) {
      const sn = sniffers.get(sm[1]);
      if (!sn) return send(res, 404, { error: 'Oturum bulunamadı.' }), true;
      if (sm[2] && req.method === 'POST') { await sn.exportCookies(); sn.close(); send(res, 200, { ok: true }); return true; } // kapatmadan önce son girişi kaydet
      if (!sm[2] && req.method === 'GET') { send(res, 200, sn.snapshot()); return true; }
    }

    const m = p.match(/^\/api\/(job|file)\/([a-f0-9]{24})$/);
    if (m && req.method === 'GET') {
      const job = jobs.get(m[2]);
      if (!job || !job.web) return send(res, 404, { error: 'İş bulunamadı ya da süresi doldu. Yeniden başlat.' }), true;

      if (m[1] === 'job') {
        const { status, percent, bytes, speed } = job;
        const out = { status, percent, bytes, speed, title: job.title };
        if (status === 'error') Object.assign(out, explain(job.error));
        if (status === 'done' && job.file) {
          out.filename = path.basename(job.file);
          try { out.size = fs.statSync(job.file).size; } catch {}
        }
        send(res, 200, out);
        return true;
      }

      // dosya: yalnızca işin kendi klasöründen
      const dir = path.resolve(WORK_DIR, job.id) + path.sep;
      if (job.status !== 'done' || !job.file || !path.resolve(job.file).startsWith(dir) || !fs.existsSync(job.file)) {
        return send(res, 404, { error: 'Dosya hazır değil.' }), true;
      }
      const name = path.basename(job.file);
      const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.writeHead(200, {
        'Content-Type': /\.mp3$/i.test(name) ? 'audio/mpeg' : 'video/mp4',
        'Content-Length': fs.statSync(job.file).size,
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(job.file).pipe(res);
      return true;
    }

    send(res, 404, { error: 'yok' });
    return true;
  };
}

module.exports = { createWeb };
