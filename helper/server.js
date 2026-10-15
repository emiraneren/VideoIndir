// VideoIndir yardımcı servisi: tarayıcı eklentisinden gelen istekleri yt-dlp'ye çevirir.
// Yalnızca 127.0.0.1 üzerinde dinler ve yalnızca tarayıcı eklentilerinden gelen isteklere cevap verir.
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ensureMp4 } = require('./mp4fix');
const { createWeb } = require('./web');

// Ortam değişkenleri: eklenti için varsayılanlar (yerel, 9696) değişmez. Site herkese açılacaksa VI_PUBLIC=1 kullanılır.
const PUBLIC = process.env.VI_PUBLIC === '1';                  // herkese açık mod: daha sıkı sınırlar, eklenti uçları kapalı
const HOST = process.env.VI_HOST || '127.0.0.1';
const PORT = parseInt(process.env.VI_PORT || '9696', 10);
const ALLOWED_HOSTS = (process.env.VI_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const WORK_DIR = path.join(__dirname, `work-${PORT}`);  // site indirmelerinin geçici dosyaları; port başına ayrı, yerel ve herkese açık örnek birbirinin dosyasını silmez
const MAX_FILESIZE = process.env.VI_MAX_FILESIZE || (PUBLIC ? '1G' : '4G'); // site indirmeleri için dosya boyutu sınırı
const BIN = path.join(__dirname, 'bin');
const YTDLP = path.join(BIN, 'yt-dlp.exe');
const FFMPEG_DIR = BIN;
const OUT_DIR = path.join(os.homedir(), 'Downloads', 'VideoIndir');

const jobs = new Map(); // id -> iş durumu
let nextId = 1;

// Önceki oturumdan kalan yarım iş klasörleri: bellekteki işler gitti, devam edilemez; disk dolmasın
try { for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith('videoindir-job-')) fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true }); } catch {}

const toolsReady = () => fs.existsSync(YTDLP) && fs.existsSync(path.join(BIN, 'ffmpeg.exe'));

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) { req.destroy(); reject(new Error('too large')); } // çerezler büyük olabilir
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function validUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch { return false; }
}

// Kullanıcıya görünen başlıktan güvenli bir dosya adı üretir; yt-dlp şablonunda % kaçışlanır
const safeName = (t) => String(t || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/%/g, '%%');

// Siteleri atlatmak için sırayla denenen istek profilleri: düz → tarayıcı taklidi (Cloudflare vb.) → Origin başlığı
const PROFILES = [
  () => [],
  () => ['--impersonate', 'chrome'],
  (referer) => {
    try { return ['--add-header', `Origin:${new URL(referer).origin}`]; } catch { return []; }
  },
];
const RETRY_RE = /403|forbidden|cloudflare|429|impersonat|just a moment|access denied|unable to download|http error/i;

// Tarayıcıdan gelen çerezleri (giriş yapılmış oturum) geçici bir dosyaya yazar; iş bitince silinir
function writeCookieFile(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1.5e6) return null;
  const f = path.join(os.tmpdir(), `videoindir-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(f, text, { mode: 0o600 });
  return f;
}
const removeFile = (f) => f && fs.rm(f, { force: true }, () => {});

// opts: {referer, ua, profile}
function netArgs(opts, cookieFile) {
  const a = [];
  if (opts.referer && validUrl(opts.referer)) a.push('--referer', opts.referer);
  if (typeof opts.ua === 'string' && opts.ua.length < 300 && !/[\r\n]/.test(opts.ua)) a.push('--user-agent', opts.ua);
  if (cookieFile) a.push('--cookies', cookieFile);
  const prof = PROFILES[opts.profile] ? opts.profile : 0;
  a.push(...PROFILES[prof](opts.referer));
  return a;
}

function runYtdlpJson(url, opts, cookieFile) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, ['-J', '--no-playlist', '--no-warnings', '--encoding', 'utf-8', ...netArgs(opts, cookieFile), '--', url], { windowsHide: true });
    const timer = setTimeout(() => { p.kill(); reject(new Error('Zaman aşımı')); }, 40000);
    p.on('close', () => clearTimeout(timer));
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.split('\n').filter(Boolean).pop() || 'yt-dlp hata verdi'));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

async function info(url, { referer, ua, cookies }) {
  const cookieFile = writeCookieFile(cookies);
  let firstErr;
  try {
    for (let profile = 0; profile < PROFILES.length; profile++) {
      try {
        const j = await runYtdlpJson(url, { referer, ua, profile }, cookieFile);
        // Kalite başına tahmini boyut: o çözünürlükteki en büyük video + (ses ayrıysa) en büyük ses
        const fmts = j.formats || [];
        const sizeOf = (f) => f.filesize || f.filesize_approx || (f.tbr && j.duration ? (f.tbr * 1000 / 8) * j.duration : null);
        const bestAudio = Math.max(0, ...fmts.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none').map((f) => sizeOf(f) || 0));
        const byHeight = new Map();
        for (const f of fmts) {
          if (!f.vcodec || f.vcodec === 'none' || !f.height) continue;
          const sz = sizeOf(f);
          const total = sz != null ? sz + (f.acodec && f.acodec !== 'none' ? 0 : bestAudio) : null;
          byHeight.set(f.height, Math.max(byHeight.get(f.height) || 0, total || 0) || null);
        }
        const options = [...byHeight].map(([height, size]) => ({ height, size })).sort((a, b) => b.height - a.height);
        return {
          title: j.title,
          thumbnail: j.thumbnail,
          duration: j.duration,
          uploader: j.uploader || j.channel,
          heights: options.map((o) => o.height),
          options,
          mp3Size: j.duration ? Math.round((245000 / 8) * j.duration) : null, // V0 VBR ≈ 245 kbps
          isLive: !!j.is_live,
          profile, // indirirken de aynı profil kullanılır
        };
      } catch (e) {
        firstErr = firstErr || e;
        if (!RETRY_RE.test(e.message)) break; // "desteklenmiyor" gibi hatalarda diğer profilleri deneme
      }
    }
    throw firstErr;
  } finally { removeFile(cookieFile); }
}

const ACTIVE = ['starting', 'downloading', 'processing', 'paused'];
const activeNames = new Set(); // sürmekte olan işlerin hedef dosya adları

// web: site üzerinden gelen iş. Her işin kendi klasörü ve tahmin edilemez kimliği vardır; eklenti listesinde görünmez.
const procs = new Map();     // iş kimliği -> çalışan yt-dlp süreci
const controls = new Map();  // iş kimliği -> {resume, cancelPaused} (duraklatılmış işi sürdürmek/iptal etmek için)

const killTree = (p) => spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });

// İndirmeyi durdurur: yt-dlp ve alt süreçleri (ffmpeg) sonlandırılır, geçici dosyalar silinir.
// Duraklatılmış bir iş de iptal edilebilir.
function cancelJob(id) {
  id = String(id);
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'paused') { const c = controls.get(id); if (c) { c.cancelPaused(); return true; } return false; }
  const p = procs.get(id);
  if (!p || !ACTIVE.includes(job.status)) return false;
  job.cancelled = true; job.paused = false;
  killTree(p);
  return true;
}

// Duraklat: süreç durdurulur ama geçici (.part/parça) dosyalar saklanır; "devam et" kaldığı yerden sürdürür.
// Birleştirme/çevirme aşamasında (processing) duraklatılmaz: kısa sürer ve yarıda kesilirse baştan yapılır.
function pauseJob(id) {
  id = String(id);
  const job = jobs.get(id), p = procs.get(id);
  if (!job || !p || !['starting', 'downloading'].includes(job.status)) return false;
  job.paused = true;
  killTree(p);
  return true;
}

function resumeJob(id) {
  id = String(id);
  const job = jobs.get(id), c = controls.get(id);
  if (!job || !c || job.status !== 'paused') return false;
  c.resume();
  return true;
}

function startJob({ url, mode, height, referer, title, ua, cookies, profile, web }) {
  // Aynı iş zaten sürüyorsa ikincisini başlatma: iki yt-dlp aynı .part dosyalarını silip bozar (site işleri kendi klasöründe çalışır)
  if (!web) {
    for (const j of jobs.values()) {
      if (!j.web && ACTIVE.includes(j.status) && j.url === url && j.mode === mode && (j.height || 0) === (height || 0)) return j;
    }
  }
  const id = web ? crypto.randomBytes(12).toString('hex') : String(nextId++);
  const outDir = web ? path.join(WORK_DIR, id) : OUT_DIR;
  let name = safeName(title);
  // Farklı iki iş aynı hedef dosyayı paylaşıyorsa (aynı başlık+tür+kalite) ikincisine sayı ekle
  const keyOf = (n) => `${n || url}|${mode}|${mode === 'mp3' ? 0 : height || 0}`;
  let baseKey = keyOf(name);
  if (!web) {
    for (let n = 2; activeNames.has(baseKey); n++) { if (name) name = `${safeName(title)} (${n})`; baseKey = keyOf(name) + '#' + n; }
    activeNames.add(baseKey);
  }
  const job = { id, url, mode, height, web: !!web, status: 'starting', percent: 0, title: name.replace(/%%/g, '%'), file: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);

  fs.mkdirSync(outDir, { recursive: true });
  // Yarım kalan (.part, parça) dosyalar işe özel geçici klasörde tutulur: iptalde ya da hatada hepsi güvenle silinir, indirilenler klasörü kirlenmez
  const tmpDir = path.join(os.tmpdir(), 'videoindir-job-' + id);
  const cookieFile = writeCookieFile(cookies);
  const args = [
    '--no-playlist', '--newline', '--no-warnings', '--windows-filenames', '--encoding', 'utf-8',
    ...netArgs({ referer, ua, profile }, cookieFile),
    '--retries', '5', '--fragment-retries', '10',
    // Eşzamanlı parça indirmede yt-dlp'nin yüzde bilgisi güvenilmez (sıçrar), bu yüzden parçalar sırayla iner.
    // --print yt-dlp'yi sessiz moda alır ve ilerleme satırlarını keser; bu yüzden ilerleme şablonunu kendimiz istiyoruz.
    '--progress', '--progress-template',
    'download:PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.fragment_index)s|%(progress.fragment_count)s|%(progress.speed)s',
    // Sesi geç başlayan HLS kayıtlarında TS→MP4 çevirmesi varsayılan analiz süresiyle başarısız olur
    '--ppa', 'FixupM3u8+ffmpeg_i:-analyzeduration 100M -probesize 100M',
    '--ffmpeg-location', FFMPEG_DIR,
    '-P', outDir,
    '-P', 'temp:' + tmpDir,
    ...(web ? ['--max-filesize', MAX_FILESIZE] : []),
    // Doğrudan akış adreslerinde (m3u8/mpd/mp4) yt-dlp'nin bulduğu başlık anlamsız olur; sekme başlığını kullan
    // Videoda kalite dosya adına eklenir; 480p ile 720p indirmesi birbirini "zaten indirilmiş" diye atlamasın
    '-o', (name ? name : web ? '%(title).120B' : '%(title).120B [%(id)s]') + (mode === 'mp3' ? '' : '%(height& [{}p]|)s') + '.%(ext)s',
    '--print', 'before_dl:TITLE:%(title)s',
    '--print', 'before_dl:NSTREAMS:%(requested_formats.1.format_id&2|1)s', // video+ses ayrı iniyorsa 2
    '--print', 'after_move:FILE:%(filepath)s',
  ];
  if (mode === 'mp3') {
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata');
  } else {
    const h = Number.isInteger(height) && height > 0 ? height : null;
    const f = h ? `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b` : 'bv*+ba/b';
    // Önce çözünürlük, aynı çözünürlükte H.264/AAC (her oynatıcıda çalışır; AV1 çoğunda ek eklenti ister)
    args.push('-f', f, '-S', 'res,vcodec:h264,acodec:aac,ext:mp4:m4a', '--merge-output-format', 'mp4');
  }
  args.push('--', url);

  const finalCleanup = () => {
    procs.delete(id); controls.delete(id);
    removeFile(cookieFile);
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    if (!web) activeNames.delete(baseKey);
  };

  // Süreç yeniden başlatılabilir (duraklat → devam et): aynı komut, aynı geçici klasör; yt-dlp .part/parça dosyalarından kaldığı yerden sürer
  const launch = () => {
    let errTail = '', buf = '';
    let nStreams = 1, streamsDone = 0, doneBytes = 0;
    const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
    const onLine = (line) => {
      line = line.trim();
      if (!line) return;
      if (line.startsWith('TITLE:')) { if (!name) job.title = line.slice(6); }
      else if (line.startsWith('NSTREAMS:')) nStreams = parseInt(line.slice(9), 10) || 1;
      else if (line.startsWith('FILE:')) job.file = line.slice(5);
      else if (line.startsWith('PROG|')) {
        const [, status, dl, total, est, fi, fc, speed] = line.split('|');
        const d = num(dl), t = num(total), e = num(est), i = num(fi), c = num(fc);
        let pct = null;
        if (c > 0 && i != null) pct = (i / c) * 100;            // parça tabanlı (HLS/DASH): en güvenilir
        else if (t > 0 && d != null) pct = (d / t) * 100;
        else if (e > 0 && d != null) pct = Math.min(99, (d / e) * 100);
        if (status === 'finished') pct = 100;
        if (pct != null) {
          const overall = ((streamsDone + pct / 100) / nStreams) * 100; // video ve ses ayrı iniyorsa ikisi birlikte
          job.percent = Math.max(job.percent, Math.min(overall, 99.9)); // devam edince geri gitmez
        }
        if (d != null) job.bytes = doneBytes + d;
        job.speed = num(speed);
        if (status === 'finished') {
          doneBytes += d || 0; streamsDone++;
          if (streamsDone >= nStreams) job.status = 'processing'; // birleştirme / çevirme / onarım aşaması
        }
      }
    };

    const p = spawn(YTDLP, args, { windowsHide: true });
    procs.set(id, p);
    job.status = 'downloading';
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(onLine);
    });
    p.stderr.on('data', (d) => (errTail = (errTail + d).slice(-600)));
    p.on('error', (e) => { job.status = 'error'; job.error = e.message; job.finishedAt = Date.now(); finalCleanup(); });
    p.on('close', async (code) => {
      if (buf) onLine(buf);
      if (job.paused && !job.cancelled) {
        // Duraklatıldı: geçici dosyalar ve çerez dosyası kalır; "devam et" aynı komutu yeniden başlatır
        procs.delete(id);
        job.status = 'paused'; job.pausedAt = Date.now(); job.speed = null;
        return;
      }
      finalCleanup();
      if (job.cancelled) {
        job.status = 'cancelled'; job.finishedAt = Date.now();
        if (web) fs.rm(outDir, { recursive: true, force: true }, () => {}); // site işinin klasörü yalnızca ona aittir
        return;
      }
      if (code !== 0) {
        job.status = 'error';
        job.error = errTail.split('\n').filter(Boolean).pop() || `Çıkış kodu ${code}`;
        job.finishedAt = Date.now();
        return;
      }
      // yt-dlp çevirmeyi sessizce atlamış olabilir: dosya ".mp4" adlı ama MPEG-TS ise onar
      if (mode !== 'mp3' && job.file) {
        job.status = 'processing';
        try { await ensureMp4(job.file, BIN); } catch {}
      }
      job.status = 'done'; job.percent = 100; job.finishedAt = Date.now();
    });
  };

  controls.set(id, {
    resume: () => { job.paused = false; launch(); },
    // Duraklatılmış işi iptal et: çalışan süreç yok, geçici dosyalar burada silinir
    cancelPaused: () => {
      job.cancelled = true; job.paused = false; job.status = 'cancelled'; job.finishedAt = Date.now();
      finalCleanup();
      if (web) fs.rm(outDir, { recursive: true, force: true }, () => {});
    },
  });
  launch();
  return job;
}

const handleWeb = createWeb({ PUBLIC, WORK_DIR, info, startJob, cancelJob, pauseJob, resumeJob, jobs, ACTIVE, send, readBody, validUrl });

const server = http.createServer(async (req, res) => {
  // DNS rebinding koruması: yalnızca bilinen host adları (yerel + VI_ALLOWED_HOSTS)
  const host = (req.headers.host || '').toLowerCase();
  // VI_ALLOWED_HOSTS girdileri tam ad (site.com) ya da alt alan joker'i (*.trycloudflare.com) olabilir
  const hostOk = host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`
    || ALLOWED_HOSTS.some((h) => h === host || (h.startsWith('*.') && host.endsWith(h.slice(1))));
  if (!hostOk) return send(res, 403, { error: 'host' });

  // Kabul edilen kaynaklar: tarayıcı eklentisi, sitenin kendisi (aynı kaynak) ya da Origin göndermeyen araçlar.
  // Başka bir web sitesindeki sayfa (CSRF) reddedilir.
  const origin = req.headers.origin;
  const isExt = !!origin && /^(chrome|moz|edge)-extension:\/\//.test(origin);
  const sameOrigin = !!origin && (origin === `http://${host}` || origin === `https://${host}`);
  if (origin && !isExt && !sameOrigin) return send(res, 403, { error: 'origin' });
  if (isExt) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const u = new URL(req.url, `http://${host}`);
  try {
    // --- Site (statik sayfa + /api/*)
    if (u.pathname.startsWith('/api/') && !toolsReady()) return send(res, 503, { error: 'Sunucuda yt-dlp / ffmpeg kurulu değil.' });
    if (await handleWeb(req, res, u)) return;

    // --- Eklenti uçları: yalnızca yerel kullanımda; herkese açık modda tamamen kapalı. Siteden de çağrılamaz.
    if (PUBLIC) return send(res, 404, { error: 'yok' });
    if (origin && !isExt) return send(res, 403, { error: 'origin' });
    if (u.pathname === '/ping') return send(res, 200, { ok: true, toolsReady: toolsReady(), outDir: OUT_DIR });
    if (!toolsReady()) return send(res, 503, { error: 'yt-dlp / ffmpeg kurulu değil. Kur.bat dosyasını çalıştırın.' });

    if (u.pathname === '/info' && req.method === 'POST') {
      const body = await readBody(req);
      if (!validUrl(body.url)) return send(res, 400, { error: 'Geçersiz adres' });
      return send(res, 200, await info(body.url, body));
    }
    if (u.pathname === '/download' && req.method === 'POST') {
      const body = await readBody(req);
      if (!validUrl(body.url)) return send(res, 400, { error: 'Geçersiz adres' });
      return send(res, 200, startJob({ ...body, mode: body.mode === 'mp3' ? 'mp3' : 'video' }));
    }
    if ((u.pathname === '/pause' || u.pathname === '/resume') && req.method === 'POST') {
      const { id } = await readBody(req);
      return send(res, 200, { ok: u.pathname === '/pause' ? pauseJob(id) : resumeJob(id) });
    }
    if (u.pathname === '/cancel' && req.method === 'POST') {
      const { id } = await readBody(req);
      return send(res, 200, { ok: cancelJob(id) });
    }
    if (u.pathname === '/jobs') {
      // site işleri (web) eklenti listesinde görünmez
      return send(res, 200, [...jobs.values()].filter((j) => !j.web).slice(-8).reverse());
    }
    if (u.pathname === '/open' && req.method === 'POST') {
      const { id } = await readBody(req);
      const job = jobs.get(String(id));
      const target = job && job.file && fs.existsSync(job.file) ? ['/select,', job.file] : [OUT_DIR];
      spawn('explorer.exe', target, { detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'yok' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log('VideoIndir zaten çalışıyor.'); process.exit(0); }
  throw e;
});
server.listen(PORT, HOST, () => console.log(`VideoIndir hazır: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}  (site)  →  ${OUT_DIR}${PUBLIC ? '  [herkese açık mod]' : ''}`));
