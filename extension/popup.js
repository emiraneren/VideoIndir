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
    (s[k] || []).forEach((x) => list.push({ url: x.url, kind: x.src, ref: x.ref }));
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

const KIND_LABEL = { net: 'akış', hook: 'api', perf: 'akış', video: 'video', iframe: 'oynatıcı', link: 'bağlantı', html: 'sayfa' };
function renderSources(selectedUrl) {
  const box = $('sources');
  box.textContent = '';
  candidates.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'src' + (c.url === selectedUrl ? ' sel' : '') + (c.failed ? ' bad' : '');
    let text = c.url;
    try {
      const u = new URL(c.url);
      text = `${u.hostname}/${decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')}`;
    } catch {}
    const small = document.createElement('small');
    small.textContent = KIND_LABEL[c.kind] || c.kind;
    const extra = c.info ? ` ${[fmtDuration(c.info.duration), c.info.heights[0] && c.info.heights[0] + 'p'].filter(Boolean).join(' · ')}` : '';
    b.append(small, document.createTextNode(text + (extra ? ' —' + extra : '')));
    b.title = c.err ? `${c.url}

${c.err}` : c.url; // başarısız kaynakta fare üstüne gelince hata görünür
    b.addEventListener('click', async () => {
      showMsg('Kaynak inceleniyor…');
      $('options').classList.add('hidden');
      try { await loadSource({ url: c.url, referer: refererFor(c), title: tab.title }, c.info); renderSources(c.url); }
      catch (e) { showMsg('Bu kaynak olmadı: ' + e.message, true); }
    });
    box.appendChild(b);
  });
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

async function refreshJobs() {
  let jobs;
  try { jobs = await api('/jobs'); } catch { return; }
  const box = $('jobs');
  box.textContent = '';
  for (const j of jobs) {
    const el = document.createElement('div');
    el.className = 'job' + (j.status === 'done' ? ' done' : '');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = j.title || j.url;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = (j.status === 'error' ? 0 : j.percent) + '%';
    bar.appendChild(fill);
    const row = document.createElement('div');
    row.className = 'row';
    const state = document.createElement('span');
    state.textContent = {
      starting: 'Başlıyor…',
      downloading: ['İndiriliyor %' + Math.floor(j.percent), fmtBytes(j.bytes), j.speed && fmtBytes(j.speed) + '/s'].filter(Boolean).join(' · '),
      processing: j.mode === 'mp3' ? 'MP3’e çevriliyor…' : 'MP4’e birleştiriliyor / çevriliyor…',
      done: 'Tamamlandı', cancelled: 'İptal edildi', error: 'Hata: ' + (j.error || ''),
    }[j.status];
    row.appendChild(state);
    if (['starting', 'downloading', 'processing'].includes(j.status)) {
      // Çalışan indirmeyi durdurur; yarım dosyalar sunucuda silinir
      const c = document.createElement('a');
      c.textContent = 'İptal';
      c.addEventListener('click', () => { c.textContent = 'İptal ediliyor…'; api('/cancel', { id: j.id }).catch(() => {}); });
      row.appendChild(c);
    }
    if (j.status === 'done') {
      const a = document.createElement('a');
      a.textContent = 'Klasörde göster';
      a.addEventListener('click', () => api('/open', { id: j.id }));
      row.appendChild(a);
    }
    el.append(name, bar, row);
    box.appendChild(el);
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
    if (!stale() && !source) { candidates = c; renderSources(); } // sayfa adresi hâlâ sürerken kaynaklar listede görünsün
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
  await Promise.all(tried.map(async (c) => {
    try {
      c.info = await api('/info', { url: c.url, referer: refererFor(c), ...(await requestContext(c.url, tab.url, tab.id)) }, 25000);
    } catch (e) { c.failed = true; c.err = e.message; }
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

(async () => {
  if (detached) {
    $('pin').classList.add('hidden');
    try { tab = await chrome.tabs.get(parseInt(tabParam, 10)); } catch { return showMsg('Sekme kapanmış. Pencereyi kapatıp yeniden aç.', true); }
  } else {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !isHttp(tab.url)) return showMsg('Bu sayfada indirilecek video yok. Bir video sayfası aç.', true);

  try { var ping = await api('/ping'); } catch {
    return showMsg('Yardımcı program çalışmıyor. VideoIndir klasöründeki Baslat.bat dosyasını çalıştır.', true);
  }
  if (!ping.toolsReady) return showMsg('İlk kurulum yapılmamış. VideoIndir klasöründeki Kur.bat dosyasını çalıştır.', true);

  refreshJobs();
  setInterval(refreshJobs, 1000);
  if (detached) watchTab();
  detect();
})();
