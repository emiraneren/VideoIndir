// common.js: API, api(), isHttp(), isPrivateHost(), requestContext()
const $ = (id) => document.getElementById(id);
let tab = null;
let source = null;       // {url, referer, title, profile} — indirilecek seçili kaynak
let candidates = [];
let recordFrame = null;  // en büyük <video>'nun bulunduğu çerçeve
let mseFlag = false;     // sayfa MediaSource (blob) kullanıyor

function showMsg(text, isErr) {
  const el = $('msg');
  el.textContent = text;
  el.className = 'msg' + (isErr ? ' err' : '');
  el.classList.toggle('hidden', !text);
}

function fmtDuration(s) {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

function fmtBytes(n) {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i >= 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

// ================= Sayfada çalışan fonksiyonlar =================
// Aşağıdaki üç fonksiyon hedef sayfaya enjekte edilir; kendi içlerinde bağımsız olmalıdır.

// Sayfa ve iframe'leri: <video>/<audio>/<source>, shadow DOM, medya bağlantıları, <link>, meta etiketleri,
// JSON-LD, <embed>/<object>, tarayıcının kaynak zaman çizelgesi (eklenti açılmadan önceki istekler) ve HTML içinde geçen adresler.
function scanPage() {
  const items = [];
  const base = location.href;
  const MEDIA = /\.(m3u8|mpd|mp4|webm|m4v|mov|mkv|mp3|m4a|flv|ogg|opus|wav|avi|wmv|3gp)(\?|#|$)/i;
  const SEGMENT = /\.(ts|m4s|cmfv|cmfa|aac)(\?|#|$)|[-_/](seg|segment|chunk|frag|fragment)[-_]?\d+|[?&](range|bytestart|sq|rn)=/i;
  const RE = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|webm|m4v|mov|mkv|mp3|m4a)(?:\?[^\s"'<>\\]*)?(?=$|[\s"'<>\\])/gi;
  const add = (u, kind) => {
    if (!u || typeof u !== 'string') return;
    let a;
    try { a = new URL(u.trim(), base).href; } catch { return; }
    if (/^https?:/.test(a)) items.push({ url: a, kind, ref: window !== window.top ? location.href : undefined });
  };

  const all = [];
  (function walk(root) {
    root.querySelectorAll('*').forEach((el) => { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); });
  })(document);

  let videos = 0, area = 0;
  for (const el of all) {
    const tag = el.tagName;
    if (tag === 'VIDEO' || tag === 'AUDIO') {
      if (tag === 'VIDEO') {
        videos++;
        const r = el.getBoundingClientRect();
        area = Math.max(area, r.width * r.height);
      }
      add(el.currentSrc, 'video'); add(el.getAttribute('src'), 'video');
      ['data-src', 'data-video-src', 'data-url', 'data-hls', 'data-stream'].forEach((a) => add(el.getAttribute(a), 'video'));
    } else if (tag === 'SOURCE') {
      add(el.getAttribute('src'), 'video'); add(el.getAttribute('data-src'), 'video');
    } else if (tag === 'IFRAME') {
      const r = el.getBoundingClientRect();
      if (r.width >= 200 && r.height >= 120) { add(el.getAttribute('src'), 'iframe'); add(el.getAttribute('data-src'), 'iframe'); }
    } else if (tag === 'A') {
      const h = el.getAttribute('href');
      if (h && (MEDIA.test(h) || el.hasAttribute('download'))) add(h, 'link');
    } else if (tag === 'EMBED') add(el.getAttribute('src'), 'video');
    else if (tag === 'OBJECT') add(el.getAttribute('data'), 'video');
    else if (tag === 'LINK') {
      if (/mpegurl|dash/i.test(el.getAttribute('type') || '') || /^(video|audio)$/i.test(el.getAttribute('as') || '')) add(el.getAttribute('href'), 'link');
    } else if (tag === 'META') {
      const n = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '').toLowerCase();
      if (/^og:(video|audio)/.test(n) || n === 'twitter:player:stream' || n === 'contenturl') add(el.content, 'video');
      else if (n === 'twitter:player' || n === 'embedurl') add(el.content, 'iframe');
    } else if (tag === 'SCRIPT' && el.type === 'application/ld+json') {
      try {
        (function walkJson(o) {
          if (!o || typeof o !== 'object') return;
          for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string' && /^(contentUrl|contentURL)$/.test(k)) add(v, 'video');
            else if (typeof v === 'string' && k === 'embedUrl') add(v, 'iframe');
            else walkJson(v);
          }
        })(JSON.parse(el.textContent));
      } catch {}
    }
  }

  try {
    performance.getEntriesByType('resource').forEach((e) => {
      if (MEDIA.test(e.name) && !SEGMENT.test(e.name)) add(e.name, 'perf');
    });
  } catch {}

  try {
    const html = document.documentElement.outerHTML;
    if (html.length < 5e6) {
      (html.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').match(RE) || []).forEach((u) => { if (!SEGMENT.test(u)) add(u, 'html'); });
    }
  } catch {}

  // Oynatıcı bir iframe içindeyse o çerçevenin kendi adresi de iyi bir adaydır
  if (videos && window !== window.top) items.push({ url: location.href, kind: 'iframe' });
  return { items, videos, area };
}

// Sayfanın JS dünyasında (MAIN): bilinen oynatıcı kütüphaneleri ve ön yükleme verileri
function scanPlayers() {
  const RE = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|webm|m4v|mov|mkv|mp3|m4a)(?:\?[^\s"'<>\\]*)?(?=$|[\s"'<>\\])/gi;
  const urls = [];
  const push = (u) => { if (typeof u === 'string' && u) urls.push(u); };
  try {
    if (window.jwplayer) {
      const pl = (window.jwplayer().getPlaylist && window.jwplayer().getPlaylist()) || [];
      pl.forEach((i) => { push(i.file); (i.sources || []).forEach((s) => push(s.file)); });
    }
  } catch {}
  try {
    if (window.videojs && window.videojs.getPlayers) {
      Object.values(window.videojs.getPlayers()).forEach((p) => {
        if (!p) return;
        push(p.currentSrc && p.currentSrc());
        (p.currentSources ? p.currentSources() : []).forEach((s) => push(s.src));
      });
    }
  } catch {}
  ['hls', 'player', 'videoPlayer', 'plyr'].forEach((n) => {
    try { const o = window[n]; if (o) { push(o.url); push(o.src); push(o.currentSrc); push(o.source && o.source.src); } } catch {}
  });
  ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', 'ytInitialPlayerResponse', 'playerConfig', 'playerOptions'].forEach((n) => {
    try {
      const v = window[n];
      if (!v) return;
      const s = JSON.stringify(v);
      if (s && s.length < 3e6) (s.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').match(RE) || []).forEach(push);
    } catch {}
  });
  return urls;
}

// Son çare: oynayan <video>'yu captureStream + MediaRecorder ile kaydedip WebM olarak indirir.
function recordVideo(name) {
  if (window.__viRec) return { error: 'Kayıt zaten sürüyor.' };
  let best = null, bestArea = -1;
  (function walk(root) {
    root.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'VIDEO') {
        const r = el.getBoundingClientRect();
        if (r.width * r.height > bestArea) { best = el; bestArea = r.width * r.height; }
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  })(document);
  if (!best) return { error: 'Bu çerçevede video yok.' };
  let stream;
  try { stream = best.captureStream ? best.captureStream() : best.mozCaptureStream(); } catch (e) { return { error: 'Video yakalanamadı: ' + e.message }; }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return { error: 'Tarayıcı WebM kaydını desteklemiyor.' };

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;background:#e11d48;color:#fff;font:600 13px system-ui,sans-serif;padding:8px 12px;border-radius:8px;display:flex;gap:10px;align-items:center;box-shadow:0 2px 12px #0006';
  const label = document.createElement('span');
  const stop = document.createElement('button');
  stop.textContent = 'Durdur ve kaydet';
  stop.style.cssText = 'background:#fff;color:#e11d48;border:0;border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer';
  bar.append(label, stop);
  document.documentElement.appendChild(bar);

  const tick = setInterval(() => {
    const d = best.duration;
    label.textContent = isFinite(d) && d > 0 ? `● Kaydediliyor %${Math.floor((best.currentTime / d) * 100)}` : `● Kaydediliyor ${Math.floor(best.currentTime)} sn`;
  }, 500);
  const finish = () => { if (rec.state !== 'inactive') rec.stop(); };
  stop.addEventListener('click', finish);
  best.addEventListener('ended', finish, { once: true });

  rec.onstop = () => {
    clearInterval(tick);
    bar.remove();
    window.__viRec = null;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    a.download = (String(name || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().slice(0, 150) || 'video') + '.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  window.__viRec = rec;
  try { best.currentTime = 0; } catch {}
  best.play().catch(() => {});
  rec.start(1000);
  return { ok: true };
}

// Sayfada çalışır (enjekte edilir, kendi içinde bağımsız): verilen kaynağa karşılık gelen videonun/oynatıcının üstüne parlayan bir çerçeve çizer.
// url null ise çerçeveyi kaldırır. Eşleşme sırası: adresi birebir tutan <video> · eşleşen iframe · sayfada oynayan/en büyük görünen video
// (ağdan yakalanan akışlar çoğu zaman o videoya aittir).
function highlightInPage(url, kind) {
  const ID = '__vi_highlight';
  const old = document.getElementById(ID);
  if (old) old.remove();
  clearTimeout(window.__viHlTimer);
  if (!url) return false;

  const vids = [];
  (function walk(root) {
    root.querySelectorAll('*').forEach((el) => { if (el.tagName === 'VIDEO') vids.push(el); if (el.shadowRoot) walk(el.shadowRoot); });
  })(document);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  };

  let target = null;
  if (kind === 'iframe') {
    target = [...document.querySelectorAll('iframe')].find((f) => {
      try { return new URL(f.getAttribute('src') || '', location.href).href === url; } catch { return false; }
    }) || null;
  }
  if (!target) target = vids.find((v) => v.currentSrc === url || v.src === url) || null;
  if (!target && vids.length) {
    const full = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    // oynayan > ekranda görünen alanı büyük > toplam boyutu büyük
    target = vids.slice().sort((a, b) => (Number(!b.paused) - Number(!a.paused)) || (visible(b) - visible(a)) || (full(b) - full(a)))[0];
  }
  if (!target) return false;
  const r0 = target.getBoundingClientRect();
  if (!r0.width || !r0.height) return false;
  if (visible(target) < r0.width * r0.height * 0.5) target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const box = document.createElement('div');
  box.id = ID;
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:3px solid #e11d48;border-radius:8px;'
    + 'box-shadow:0 0 0 4px rgba(225,29,72,.35),0 0 28px 8px rgba(225,29,72,.75),inset 0 0 24px 4px rgba(225,29,72,.35);';
  const chip = document.createElement('div');
  chip.textContent = 'VideoIndir: bu kaynak';
  chip.style.cssText = 'position:absolute;left:6px;top:6px;background:#e11d48;color:#fff;font:600 12px system-ui,sans-serif;padding:3px 8px;border-radius:6px;';
  box.appendChild(chip);
  document.documentElement.appendChild(box);

  const place = () => { // kaydırma/yeniden boyutlandırmada çerçeve videoyu izlesin
    if (!box.isConnected) return;
    const r = target.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    requestAnimationFrame(place);
  };
  place();
  window.__viHlTimer = setTimeout(() => box.remove(), 6000); // popup kapanırsa çerçeve kalıcı kalmasın
  return true;
}

// ================= Kaynak bulma =================

const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i;
function rank(c) {
  if (MANIFEST_RE.test(c.url)) return 0;
  if (c.kind === 'net' || c.kind === 'hook' || c.kind === 'perf') return 1;
  if (c.kind === 'video') return 2;
  if (c.kind === 'iframe') return 4;
  return 3; // link, html
}

async function findCandidates() {
  const list = [];
  const k = 't' + tab.id;
  try {
    const s = await chrome.storage.session.get([k, 'm' + tab.id]);
    mseFlag = !!s['m' + tab.id];
    (s[k] || []).forEach((x) => list.push({ url: x.url, kind: x.src, ref: x.ref, size: x.size, mime: x.type }));
  } catch {}

  // injectImmediately: hâlâ yüklenen bir iframe taramayı sonsuza dek bekletmesin. Yine de 6 sn sınır var.
  const inject = (extra) => withTimeout(
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, injectImmediately: true, ...extra }).catch(() => []),
    6000, []);
  recordFrame = null;
  const [pageFrames, playerFrames] = await Promise.all([inject({ func: scanPage }), inject({ world: 'MAIN', func: scanPlayers })]);
  let bestArea = 0;
  pageFrames.forEach((f) => {
    const r = f.result;
    if (!r) return;
    r.items.forEach((i) => list.push(i));
    if (r.videos && r.area >= bestArea) { bestArea = r.area; recordFrame = f.frameId; }
  });
  playerFrames.forEach((f) => (f.result || []).forEach((u) => list.push({ url: u, kind: 'hook' })));

  const seen = new Set();
  return list
    .map((c) => { try { return { ...c, url: new URL(c.url, tab.url).href }; } catch { return null; } })
    .filter((c) => c && isHttp(c.url) && !isPrivateHost(c.url) && c.url !== tab.url && !seen.has(c.url) && seen.add(c.url))
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i);
}

// Kaynağı isteyen sayfa sekmeden farklı bir siteyse (iframe oynatıcı) Referer o olmalı
function refererFor(c) {
  try { if (c.ref && new URL(c.ref).origin !== new URL(tab.url).origin) return c.ref; } catch {}
  return tab.url;
}

const SOURCE_LIMIT = 8; // Facebook gibi sitelerde yüzlerce adres olabilir; varsayılan olarak en olası 8'i göster
let showAllSources = false;

// Listede ham adres yerine "bu ne?" sorusunu cevaplayan bir ad göster: tür + (biliniyorsa) süre/kalite/boyut
function describeSource(c) {
  const m = (c.mime || '').toLowerCase();
  let type = { net: 'Akış', perf: 'Akış', hook: 'Sayfa verisi', video: 'Sayfadaki video', iframe: 'Oynatıcı', link: 'Bağlantı', html: 'Sayfa içi adres' }[c.kind] || 'Kaynak';
  if (MANIFEST_RE.test(c.url) || /mpegurl|dash/.test(m)) type = 'Yayın akışı';
  else if (m.startsWith('audio/')) type = 'Ses dosyası';
  else if (m.startsWith('video/')) type = 'Video dosyası';

  const parts = [];
  if (c.info) {
    const h = c.info.heights && c.info.heights[0];
    type = h ? 'Video' : (c.info.duration ? 'Sadece ses' : type);
    if (c.info.duration) parts.push(fmtDuration(c.info.duration));
    if (h) parts.push(h + 'p');
  }
  if (c.size) parts.push(fmtBytes(c.size));
  if (!parts.length) {
    // Hiçbir şey bilinmiyorsa en azından hangi siteden geldiğini (ör. "fbcdn.net") göster
    try { parts.push(new URL(c.url).hostname.split('.').slice(-2).join('.')); } catch { parts.push('?'); }
    if (c.pending) parts.push('inceleniyor…');
  }
  return { type, detail: parts.join(' · ') };
}

// Fare kaynağın üzerindeyken sayfadaki ilgili videoyu parlat (null: parlatmayı kaldır)
function highlight(c) {
  if (!tab) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true }, injectImmediately: true,
    func: highlightInPage, args: [c ? c.url : null, c ? c.kind : null],
  }).catch(() => {});
}
window.addEventListener('pagehide', () => highlight(null));

function renderSources(selectedUrl) {
  const box = $('sources');
  box.textContent = '';
  // Çözülenler (gerçek video/ses) üstte, denenmemişler ortada, başarısızlar en sonda
  const order = (c) => (c.info ? 0 : c.failed ? 2 : 1);
  const ordered = candidates.map((c, i) => ({ c, i })).sort((a, b) => order(a.c) - order(b.c) || a.i - b.i).map((x) => x.c);
  let shown = showAllSources ? ordered : ordered.slice(0, SOURCE_LIMIT);
  const sel = ordered.find((c) => c.url === selectedUrl);
  if (sel && !shown.includes(sel)) shown = [sel, ...shown]; // seçili kaynak her zaman görünsün
  shown.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'src' + (c.url === selectedUrl ? ' sel' : '') + (c.failed ? ' bad' : '');
    const { type, detail } = describeSource(c);
    const small = document.createElement('small');
    small.textContent = type;
    b.append(small, document.createTextNode(detail));
    b.title = (c.err ? c.url + '\n\n' + c.err : c.url) + '\n\nÜzerine gelince sayfadaki video parlar.'; // ham adres ipucunda
    b.addEventListener('mouseenter', () => highlight(c));
    b.addEventListener('mouseleave', () => highlight(null));
    b.addEventListener('click', async () => {
      highlight(null);
      showMsg('Kaynak inceleniyor…');
      $('options').classList.add('hidden');
      try { await loadSource({ url: c.url, referer: refererFor(c), title: tab.title }, c.info); renderSources(c.url); }
      catch (e) { showMsg('Bu kaynak olmadı: ' + e.message, true); }
    });
    box.appendChild(b);
  });
  if (!showAllSources && ordered.length > SOURCE_LIMIT) {
    const more = document.createElement('button');
    more.className = 'link';
    more.textContent = 'Diğer ' + (ordered.length - SOURCE_LIMIT) + ' kaynağı göster';
    more.addEventListener('click', () => { showAllSources = true; renderSources(selectedUrl); });
    box.appendChild(more);
  }
  $('sourcesBox').classList.toggle('hidden', !candidates.length);
}

// ================= Seçenekleri gösterme =================

async function loadSource(src, preInfo, timeoutMs) {
  const info = preInfo || await api('/info', { url: src.url, referer: src.referer, ...(await requestContext(src.url, tab.url, tab.id)) }, timeoutMs);
  source = { ...src, profile: info.profile };
  showMsg('');
  renderOptions(info, src);
}

function renderOptions(info, src) {
  // Doğrudan akışlarda yt-dlp'nin başlığı anlamsızdır ("master" gibi); sekme başlığını göster
  $('title').textContent = src.referer && src.title ? src.title : (info.title || src.url);
  $('sub').textContent = [info.uploader, fmtDuration(info.duration)].filter(Boolean).join(' · ');
  $('thumb').removeAttribute('src');
  if (info.thumbnail) $('thumb').src = info.thumbnail;
  $('video').classList.remove('hidden');

  const box = $('qualities');
  box.textContent = '';
  const heights = (info.heights || []).slice(0, 6);
  if (!heights.length) heights.push(0); // yükseklik bilgisi yoksa tek "en iyi" düğmesi
  heights.forEach((h, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' best' : '');
    b.textContent = h ? `${h}p` : 'En iyi';
    b.title = i === 0 && h ? 'En yüksek kalite' : '';
    b.addEventListener('click', () => start('video', h || null));
    box.appendChild(b);
  });
  $('mp3').onclick = () => start('mp3');
  $('options').classList.remove('hidden');
}

async function start(mode, height) {
  try {
    const ctx = await requestContext(source.url, tab.url, tab.id);
    await api('/download', {
      url: source.url, referer: source.referer, title: source.referer ? source.title : undefined,
      profile: source.profile, mode, height, ...ctx,
    });
    refreshJobs();
  } catch (e) { showMsg(e.message, true); }
}

// ================= İş listesi =================

// Her iş için bir kart tutulur ve her saniye YERİNDE güncellenir (baştan çizilmez): yoksa düğmeye basarken kart yenilenir ve tıklama kaybolur.
const jobEls = new Map(); // iş kimliği -> {el, name, fill, state, ctl, mode}
let jobOrder = '';

function jobCardFor(j) {
  let c = jobEls.get(j.id);
  if (c) return c;
  const el = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  bar.appendChild(fill);
  const row = document.createElement('div');
  row.className = 'row';
  const state = document.createElement('span');
  const ctl = document.createElement('span');
  ctl.className = 'ctl';
  row.append(state, ctl);
  el.append(name, bar, row);
  c = { el, name, fill, state, ctl, mode: null };
  jobEls.set(j.id, c);
  return c;
}

// Duraklat / Devam et / İptal düğmeleri (iş durumuna göre); yalnızca durum değişince yeniden kurulur
function setJobControls(c, j) {
  const mode = j.status === 'done' ? 'done' : ['cancelled', 'error'].includes(j.status) ? 'end' : j.status;
  if (c.mode === mode) return;
  c.mode = mode;
  c.ctl.textContent = '';
  const mini = (text, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'mini ' + cls;
    b.textContent = text;
    b.addEventListener('click', () => { b.disabled = true; fn().catch(() => {}); });
    return b;
  };
  if (mode === 'queued') c.ctl.appendChild(mini('İptal', 'cancel', () => api('/cancel', { id: j.id })));
  else if (mode === 'paused') c.ctl.appendChild(mini('Devam et', 'resume', () => api('/resume', { id: j.id })));
  else if (['starting', 'downloading'].includes(mode)) c.ctl.appendChild(mini('Duraklat', 'pause', () => api('/pause', { id: j.id })));
  if (['starting', 'downloading', 'processing', 'paused'].includes(mode)) c.ctl.appendChild(mini('İptal', 'cancel', () => api('/cancel', { id: j.id })));
  if (mode === 'done') {
    const a = document.createElement('a');
    a.textContent = 'Klasörde göster';
    a.addEventListener('click', () => api('/open', { id: j.id }));
    c.ctl.appendChild(a);
  }
}

async function refreshJobs() {
  let jobs;
  try { jobs = await api('/jobs'); } catch { return; }
  const box = $('jobs');
  for (const j of jobs) {
    const c = jobCardFor(j);
    c.el.className = 'job' + (j.status === 'done' ? ' done' : '') + (j.status === 'paused' ? ' paused' : '') + (j.status === 'cancelled' ? ' cancelled' : '');
    c.name.textContent = j.title || j.url;
    c.fill.style.width = (j.status === 'error' ? 0 : j.percent) + '%';
    c.state.textContent = {
      queued: 'Sırada bekliyor' + (j.queuePos ? ' (' + j.queuePos + '. sıra)' : '') + '…',
      starting: 'Başlıyor…',
      downloading: ['İndiriliyor %' + Math.floor(j.percent), fmtBytes(j.bytes), j.speed && fmtBytes(j.speed) + '/s'].filter(Boolean).join(' · '),
      paused: ['Duraklatıldı %' + Math.floor(j.percent), fmtBytes(j.bytes)].filter(Boolean).join(' · '),
      processing: j.mode === 'mp3' ? 'MP3’e çevriliyor…' : 'MP4’e birleştiriliyor / çevriliyor…',
      done: 'Tamamlandı', cancelled: 'İptal edildi', error: j.error || 'İndirilemedi.',
    }[j.status];
    setJobControls(c, j);
  }
  // Kartları yalnızca sıra/küme değiştiyse yeniden diz (her saniye taşımak tıklamayı bozar)
  const order = jobs.map((j) => j.id).join(',');
  if (order !== jobOrder) {
    jobOrder = order;
    box.textContent = '';
    for (const j of jobs) box.appendChild(jobEls.get(j.id).el);
  }
}

// ================= Akış =================
// 1) sayfa adresi → 2) ağ/sayfa/oynatıcı taramasıyla bulunan kaynaklar (paralel denenir, en uzun olan seçilir) →
// 3) elle adres → 4) oynatırken kayıt

let runId = 0;
async function detect() {
  const id = ++runId;
  const stale = () => id !== runId; // "yeniden tara"ya basılınca eski çalıştırmanın sonuçları yok sayılır
  source = null;
  $('video').classList.add('hidden');
  $('options').classList.add('hidden');
  $('sourcesBox').classList.add('hidden');
  showMsg('Video bilgisi alınıyor…');

  // Sayfa taraması sayfa adresi denemesiyle aynı anda başlar; yavaş bir siteyi beklemeden kaynaklar hazır olur
  const scanP = findCandidates().then((c) => {
    if (!stale() && !source) { // sayfa adresi hâlâ sürerken kaynaklar listede görünsün
      candidates = c;
      renderSources();
      if (c.length) showMsg('Sayfa adresi inceleniyor… Beklemek istemezsen aşağıdaki kaynaklardan birini seçebilirsin.');
    }
    return c;
  });

  try {
    await loadSource({ url: tab.url }, null, 20000);
    return;
  } catch {}
  if (stale()) return;

  showMsg('Sayfa adresinden çözülemedi, sayfadaki video kaynakları taranıyor…');
  candidates = await scanP;
  if (stale()) return;
  renderSources();

  // En olası 6 kaynağı aynı anda dene; reklam gibi kısa videolar yerine en uzun olanı seç
  const tried = candidates.slice(0, 6);
  if (tried.length) showMsg(`${candidates.length} kaynak bulundu, deneniyor…`);
  tried.forEach((c) => { c.pending = true; });
  renderSources();
  await Promise.all(tried.map(async (c) => {
    try {
      c.info = await api('/info', { url: c.url, referer: refererFor(c), ...(await requestContext(c.url, tab.url, tab.id)) }, 25000);
    } catch (e) { c.failed = true; c.err = e.message; }
    c.pending = false;
    if (!stale() && !source) renderSources(); // her kaynak çözüldükçe adı (süre/kalite) canlı güncellensin
  }));
  if (stale()) return;
  const ok = tried.filter((c) => c.info);
  if (ok.length) {
    ok.sort((a, b) => (b.info.duration || 0) - (a.info.duration || 0) || (b.info.heights[0] || 0) - (a.info.heights[0] || 0));
    const c = ok[0];
    await loadSource({ url: c.url, referer: refererFor(c), title: tab.title }, c.info);
    renderSources(c.url);
    return;
  }

  renderSources();
  $('more').open = true;
  const hasVideoEl = recordFrame != null;
  showMsg(
    (candidates.length ? 'Bulunan kaynakların hiçbiri indirilemedi. ' : 'Video bulunamadı. ')
    + (mseFlag || hasVideoEl ? 'Bu site videoyu gizli/parçalı yüklüyor olabilir; aşağıdaki “Oynatırken kaydet” yöntemi çalışır. ' : '')
    + 'Videoyu oynatıp yeniden taramayı da deneyebilirsin.', true);
}

$('manualGo').addEventListener('click', async () => {
  const url = $('manualUrl').value.trim();
  if (!isHttp(url)) return showMsg('Geçerli bir http(s) adresi yapıştır.', true);
  showMsg('Adres inceleniyor…');
  try { await loadSource({ url, referer: tab.url, title: tab.title }); }
  catch (e) { showMsg('Bu adresten video alınamadı: ' + e.message, true); }
});
$('manualPaste').addEventListener('click', async () => {
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (!t) return showMsg('Panoda adres yok. Önce bir bağlantıyı kopyala.', true);
    $('manualUrl').value = t;
    $('manualGo').click();
  } catch { showMsg('Panoya erişilemedi. Adresi kutuya Ctrl+V ile yapıştır.', true); }
});
$('rescan').addEventListener('click', detect);

$('record').addEventListener('click', async () => {
  try {
    if (recordFrame == null) await findCandidates(); // çerçeveyi (yeniden) bul
    if (recordFrame == null) return showMsg('Sayfada <video> öğesi bulunamadı. Videoyu oynatıp tekrar dene.', true);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [recordFrame] }, injectImmediately: true, func: recordVideo, args: [tab.title] });
    if (res.result && res.result.error) return showMsg(res.result.error, true);
    if (!detached) window.close(); // kayıt sayfada sürer; ilerleme sayfanın köşesindeki kırmızı kutuda görünür
    else showMsg('Kayıt başladı. İlerleme sayfanın sağ üst köşesindeki kırmızı kutuda; oradan durdurabilirsin.');
  } catch (e) { showMsg('Kayıt başlatılamadı: ' + e.message, true); }
});

// "Açık tut": popup başka yere tıklanınca kapanır ve bu engellenemez. Bu yüzden aynı arayüz ayrı, kapanmayan küçük bir pencerede de açılabilir.
// Ayrı pencerede hedef sekme adreste ?tab=<id> ile gelir; sekmede yeni akış bulununca ya da sayfa değişince kendiliğinden yenilenir.
const tabParam = new URLSearchParams(location.search).get('tab');
const detached = tabParam !== null;

function watchTab() {
  let timer = 0;
  const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  // Sayfa değiştiyse (yeni video/sayfa) baştan tara
  chrome.tabs.onUpdated.addListener((id, change) => {
    if (id !== tab.id || !(change.url || change.status === 'complete')) return;
    later(async () => { try { tab = await chrome.tabs.get(tab.id); } catch { return; } if (change.url) source = null; detect(); }, 1200);
  });
  // Video oynamaya başlayınca ağda yeni akış görünür; henüz bir kaynak seçilmediyse yeniden tara
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes['t' + tab.id] && !source) later(detect, 1500);
  });
  chrome.tabs.onRemoved.addListener((id) => { if (id === tab.id) window.close(); });
}

$('pin').addEventListener('click', async () => {
  await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html?tab=' + tab.id),
    type: 'popup', width: 390, height: 680, incognito: !!tab.incognito,
  });
  window.close();
});

const pingApp = () => api('/ping', null, 2000).catch(() => null);
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); }
  return null;
}

$('openApp').addEventListener('click', async () => {
  const b = $('openApp');
  b.disabled = true;
  showMsg('Uygulama açılıyor…');
  // videoindir: bağlantısını gizli bir çerçevede açmak tarayıcıyı bozmadan uygulamayı başlatır
  const f = document.createElement('iframe');
  f.style.display = 'none';
  f.src = 'videoindir://start';
  document.body.appendChild(f);
  const p = await waitFor(pingApp, 25000);
  b.disabled = false;
  if (!p) return showMsg('Uygulama açılmadı. Masaüstündeki VideoIndir simgesine çift tıkla, sonra bu pencereyi yeniden aç.', true);
  location.reload();
});

(async () => {
  if (detached) {
    $('pin').classList.add('hidden');
    try { tab = await chrome.tabs.get(parseInt(tabParam, 10)); } catch { return showMsg('Sekme kapanmış. Pencereyi kapatıp yeniden aç.', true); }
  } else {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !isHttp(tab.url)) return showMsg('Bu sayfada indirilecek video yok. Bir video sayfası aç.', true);

  let ping = await pingApp();
  if (!ping) {
    // Uygulama kapalı: tek tıkla açılır (videoindir: bağlantısı exe'yi sessizce başlatır)
    showMsg('VideoIndir uygulaması kapalı. İndirmek için önce uygulamayı aç.', true);
    $('openApp').classList.remove('hidden');
    return;
  }
  if (!ping.toolsReady) {
    showMsg('VideoIndir ilk kurulumunu yapıyor, bir dakika bekle…');
    ping = await waitFor(async () => { const p = await pingApp(); return p && p.toolsReady ? p : null; }, 180000);
    if (!ping) return showMsg('İlk kurulum bitmedi. VideoIndir uygulamasını aç ve kurulumun bitmesini bekle, sonra bu pencereyi yeniden aç.', true);
  }

  refreshJobs();
  setInterval(refreshJobs, 1000);
  if (detached) watchTab();
  detect();
})();
