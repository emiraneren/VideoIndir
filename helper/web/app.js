'use strict';
const $ = (id) => document.getElementById(id);
const form = $('form'), urlInput = $('url'), goBtn = $('go'), statusEl = $('status');
const resultEl = $('result'), jobsEl = $('jobs');
let current = null; // çözülen video: {url, profile, ...}

function fmtBytes(n) {
  if (!n || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i >= 3 ? n.toFixed(2) : i === 2 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

function fmtDuration(s) {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

async function request(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Bir hata oluştu.'), { detail: data.detail, status: res.status });
  return data;
}

// Mesajlar textContent ile yazılır: başlık/hata metinleri dış kaynaktan gelir, HTML olarak yorumlanmamalı
function setStatus(text, isError, detail) {
  statusEl.textContent = text || '';
  statusEl.className = 'status' + (isError ? ' error' : '');
  appendDetail(statusEl, detail);
}

// ---------- 1) Bağlantıyı çöz ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;
  goBtn.disabled = true;
  resultEl.hidden = true;
  setStatus('Bağlantı çözülüyor… birkaç saniye sürebilir.');
  try {
    current = await request('/api/resolve', { url });
    sniffBtn.classList.remove('attn');
    renderResult(current);
    setStatus('');
  } catch (err) {
    current = null;
    setStatus(err.message, true, err.detail);
    sniffBtn.classList.add('attn'); // çözülemedi: sayfadan yakalama (ve giriş) yolunu öne çıkar
  } finally { goBtn.disabled = false; }
});

// Panodan yapıştırınca doğrudan çöz: tek adımda sonuca git
function autoSubmitIfUrl() {
  setTimeout(() => { if (/^https?:\/\/\S+$/i.test(urlInput.value.trim())) form.requestSubmit(); }, 0);
}
urlInput.addEventListener('paste', autoSubmitIfUrl);
$('paste').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!/^https?:\/\//i.test(text)) { setStatus('Panoda bir video bağlantısı yok. Önce videonun bağlantısını kopyala, sonra tekrar bas.', true); return; }
    urlInput.value = text;
    urlInput.focus();
    autoSubmitIfUrl();
  } catch { setStatus('Pano okunamadı. Tarayıcı izin istiyorsa "İzin ver"e bas; olmazsa bağlantıyı kutuya yapıştır.', true); }
});

// Masaüstü uygulaması bağlantıyı adresle gönderir (?url=...): kutuya yaz ve hemen çöz. Yalnızca çözer, indirmeyi başlatmaz.
(function openWithLink() {
  const q = new URLSearchParams(location.search).get('url');
  if (!q || !/^https?:\/\/\S+$/i.test(q)) return;
  urlInput.value = q;
  history.replaceState(null, '', location.pathname); // adres çubuğunu/geçmişi temiz tut
  form.requestSubmit();
})();

// ---------- 2) Formatları göster ----------
function formatButton(label, size, best, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fmt' + (best ? ' best' : '');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.textContent = size ? '~' + fmtBytes(size) : (best ? 'en iyi kalite' : ' ');
  b.append(strong, span);
  b.addEventListener('click', onClick);
  return b;
}

function renderResult(meta) {
  $('title').textContent = meta.title || meta.url;
  $('sub').textContent = [meta.uploader, fmtDuration(meta.duration)].filter(Boolean).join(' · ');
  const thumb = $('thumb');
  thumb.removeAttribute('src');
  if (meta.thumbnail && /^https:\/\//i.test(meta.thumbnail)) thumb.src = meta.thumbnail;
  thumb.hidden = !thumb.getAttribute('src');

  const q = $('qualities');
  q.textContent = '';
  const options = meta.options && meta.options.length ? meta.options.slice(0, 8) : [{ height: null, size: null }];
  options.forEach((o, i) => {
    q.appendChild(formatButton(o.height ? o.height + 'p' : 'En iyi', o.size, i === 0, () => startDownload('video', o.height, o.height ? o.height + 'p MP4' : 'MP4')));
  });

  const a = $('audio');
  a.textContent = '';
  a.appendChild(formatButton('MP3', meta.mp3Size, false, () => startDownload('mp3', null, 'MP3')));
  resultEl.hidden = false;
}

// ---------- 3) İndir ----------
const STATE_TEXT = { starting: 'Başlıyor…', processing: 'Dosya hazırlanıyor (birleştirme / dönüştürme)…' };
const ACTIVE_STATES = ['starting', 'downloading', 'processing'];

// Teknik ayrıntı (ham hata) varsayılan olarak gizli; merak eden "Teknik ayrıntı"ya basar
function appendDetail(parent, detail) {
  if (!detail) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'mini-link'; b.textContent = 'Teknik ayrıntı';
  const d = document.createElement('span');
  d.className = 'detail'; d.textContent = detail; d.hidden = true;
  b.addEventListener('click', () => { d.hidden = !d.hidden; });
  parent.append(b, d);
}

function jobCard(label, title, onRetry) {
  const el = document.createElement('div');
  el.className = 'job';
  el.innerHTML = '<div class="top"><span class="name"></span><span class="tag"></span></div><div class="bar"><i></i></div><div class="state"></div><div class="actions"></div>';
  el.querySelector('.name').textContent = title || 'Video';
  el.querySelector('.tag').textContent = label;
  const state = el.querySelector('.state'), fill = el.querySelector('i'), actions = el.querySelector('.actions');
  const button = (text, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    b.addEventListener('click', () => fn(b));
    return b;
  };
  const fire = (path) => request(path, {}).catch(() => {});

  // Düğmeler iş durumuna göre: sürerken [Duraklat] [İptal], duraklatılmışken [Devam et] [İptal], sıradayken/birleştirirken yalnızca [İptal]
  let handlers = null;   // {pause, resume, cancel}
  let mode = 'running';  // running | paused | processing | queued
  const renderControls = () => {
    if (!handlers) return;
    const list = [];
    if (mode === 'paused') list.push(button('Devam et', 'ghost resume', (b) => { b.disabled = true; handlers.resume(); }));
    else if (mode === 'running') list.push(button('Duraklat', 'ghost pause', (b) => { b.disabled = true; handlers.pause(); }));
    list.push(button('İptal', 'ghost cancel', (b) => { b.disabled = true; handlers.cancel(); }));
    actions.replaceChildren(...list);
  };

  return {
    el,
    setControls(h) { handlers = h; renderControls(); },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      el.classList.toggle('paused', m === 'paused');
      el.classList.toggle('queued', m === 'queued');
      renderControls();
    },
    progress(percent, text) { fill.style.width = Math.max(0, Math.min(100, percent)) + '%'; state.textContent = text; },
    // local: dosya zaten indirme klasörüne kaydedildi (ikinci bir "indir" adımı yok); değilse (herkese açık site) tarayıcıdan indirilir
    done(id, size, filename, local) {
      el.classList.remove('paused', 'queued');
      el.classList.add('done');
      fill.style.width = '100%';
      if (local) {
        state.textContent = 'Hazır' + (size ? ' · ' + fmtBytes(size) : '') + ' · indirme klasörüne kaydedildi';
        actions.replaceChildren(
          button('Klasörde göster', 'ghost', () => fire('/api/job/' + id + '/reveal')),
          button('Aç', 'ghost', () => fire('/api/job/' + id + '/open')));
        return;
      }
      state.textContent = 'Hazır' + (size ? ' · ' + fmtBytes(size) : '');
      const a = document.createElement('a');
      a.className = 'dl';
      a.href = '/api/file/' + id;
      a.setAttribute('download', filename || '');
      a.textContent = 'Dosyayı indir';
      actions.replaceChildren(a);
    },
    cancelled() {
      el.classList.remove('paused', 'queued');
      el.classList.add('cancelled');
      state.textContent = 'İptal edildi';
      actions.replaceChildren(...(onRetry ? [button('Tekrar başlat', 'ghost', () => { el.remove(); onRetry(); })] : []));
    },
    error(message, detail) {
      el.classList.remove('paused', 'queued');
      el.classList.add('error');
      state.textContent = message;
      appendDetail(state, detail);
      actions.replaceChildren(...(onRetry ? [button('Tekrar dene', 'ghost', () => { el.remove(); onRetry(); })] : []));
    },
  };
}

async function startDownload(kind, height, label) {
  const video = { ...current }; // indirme sürerken yeni bir video çözülürse bu işin bilgileri değişmesin
  const card = jobCard(label, video.title, () => { current = video; startDownload(kind, height, label); });
  jobsEl.prepend(card.el);
  card.progress(0, STATE_TEXT.starting);
  try {
    const { id } = await request('/api/start', {
      url: video.url, kind, height, profile: video.profile,
      referer: video.referer, title: video.fromSniff ? video.title : undefined, // sayfadan yakalanan akışlarda sayfa başlığı dosya adı olur
    });
    const act = (what) => () => request('/api/job/' + id + '/' + what, {}).catch(() => {});
    card.setControls({ pause: act('pause'), resume: act('resume'), cancel: act('cancel') });
    poll(id, card);
  } catch (err) { card.error(err.message, err.detail); }
}

function poll(id, card) {
  const timer = setInterval(async () => {
    try {
      const j = await request('/api/job/' + id);
      if (j.status === 'done') {
        clearInterval(timer);
        card.done(id, j.size, j.filename, j.local);
        if (typeof refreshHistory === 'function' && !$('view-history').hidden) refreshHistory();
        return;
      }
      if (j.status === 'cancelled') { clearInterval(timer); card.cancelled(); return; }
      if (j.status === 'error') { clearInterval(timer); card.error(j.error, j.detail); return; }
      if (j.status === 'queued') {
        card.setMode('queued');
        card.progress(0, 'Sırada bekliyor' + (j.queuePos ? ' (' + j.queuePos + '. sıra)' : '') + ' · önceki indirmeler bitince kendiliğinden başlar');
        return;
      }
      if (j.status === 'paused') {
        card.setMode('paused');
        card.progress(j.percent, ['Duraklatıldı %' + Math.floor(j.percent), fmtBytes(j.bytes)].filter(Boolean).join(' · '));
        return;
      }
      card.setMode(j.status === 'processing' ? 'processing' : 'running');
      const text = j.status === 'processing'
        ? STATE_TEXT.processing
        : ['İndiriliyor %' + Math.floor(j.percent), fmtBytes(j.bytes), j.speed && fmtBytes(j.speed) + '/s'].filter(Boolean).join(' · ');
      card.progress(j.percent, text);
    } catch (err) { clearInterval(timer); card.error(err.message); }
  }, 800);
}

// ---------- 4) Sayfadan videoyu bul (eklentisiz akış yakalama) ----------
// Sayfa adresi yetmeyen sitelerde (iframe oynatıcı, m3u8/mpd akışı) sayfa ayrı bir tarayıcı penceresinde açılır;
// kullanıcı videoyu orada oynatınca ağda görülen akışlar burada listelenir.
const sniffBtn = $('sniffBtn'), sniffBox = $('sniff'), sniffText = $('sniffText'), sniffList = $('sniffList');
let sniff = null; // {id, timer, probed: Map(url -> {state, meta, ref, err}), manual: bool, snap}

const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i;
const KIND_LABEL = { net: 'akış', hook: 'api', perf: 'akış', video: 'video', iframe: 'oynatıcı', link: 'bağlantı', html: 'sayfa', dom: 'sayfa', page: 'sayfa (giriş)' };
function rank(c) {
  if (MANIFEST_RE.test(c.url)) return 0;
  if (c.kind === 'net' || c.kind === 'hook' || c.kind === 'perf') return 1;
  if (c.kind === 'video') return 2;
  if (c.kind === 'iframe') return 4;
  return 3;
}

// Kaynağı isteyen sayfa, sayfanın kendisinden farklı bir siteyse (iframe oynatıcı) Referer o olmalı
function refererFor(c, snap) {
  try { if (c.ref && new URL(c.ref).origin !== new URL(snap.pageUrl).origin) return c.ref; } catch {}
  return snap.pageUrl;
}

async function startSniff() {
  const url = urlInput.value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return setStatus('Önce video sayfasının adresini kutuya yapıştır.', true);
  stopSniffPolling();
  sniffBtn.disabled = true;
  setStatus('Sayfa ayrı bir pencerede açılıyor…');
  try {
    const { id } = await request('/api/sniff/start', { url });
    sniff = { id, timer: 0, probed: new Map(), manual: false, snap: null, startedAt: Date.now() };
    sniffBox.hidden = false;
    sniffText.textContent = 'Açılan pencerede videoyu oynat. Bulunan kaynaklar burada görünür.';
    sniffList.textContent = '';
    setStatus('');
    sniff.timer = setInterval(pollSniff, 1500);
    pollSniff();
  } catch (err) { setStatus(err.message, true, err.detail); }
  finally { sniffBtn.disabled = false; }
}

function stopSniffPolling() { if (sniff && sniff.timer) { clearInterval(sniff.timer); sniff.timer = 0; } }

async function pollSniff() {
  const s = sniff;
  if (!s) return;
  let snap;
  try { snap = await request('/api/sniff/' + s.id); } catch { stopSniffPolling(); sniffText.textContent = 'Bağlantı koptu.'; return; }
  if (sniff !== s) return;
  s.snap = snap;
  // Sayfa başlığı yüklenme sırasında sonradan netleşebilir; seçili kaynağın başlığını güncel tut
  if (current && current.fromSniff && snap.title && current.title !== snap.title) {
    current.title = snap.title;
    $('title').textContent = snap.title;
  }
  const cands = snap.candidates.slice().sort((a, b) => rank(a) - rank(b));
  if (snap.status === 'closed') { stopSniffPolling(); sniffText.textContent = 'Pencere kapatıldı. Listeden bir kaynak seçebilirsin.'; }
  else if (!cands.length) sniffText.textContent = Date.now() - s.startedAt > 12000
    ? 'Henüz akış yakalanmadı. Site giriş istiyorsa pencerede giriş yap (bir kez yeterli), sonra videoyu oynat.'
    : 'Açılan pencerede videoyu oynat. Bulunan kaynaklar burada görünür.';
  else sniffText.textContent = cands.length + ' kaynak bulundu. En olası olan otomatik seçilir.';

  // Giriş yapılınca (çerezler değişince) sayfa adresini çerezlerle çöz: Facebook reel, Instagram gibi giriş isteyen videolar.
  // Başarısız olursa yalnızca çerezler değiştiyse ve 8 sn geçtiyse yeniden dener.
  const pageEntry = s.probed.get(snap.pageUrl);
  if (snap.cookieVersion > 0 && snap.cookieVersion !== s.cookieSeen && (!pageEntry || (pageEntry.state === 'bad' && Date.now() - pageEntry.at > 8000))) {
    s.cookieSeen = snap.cookieVersion;
    probeCandidate({ url: snap.pageUrl, kind: 'page', page: true }, snap);
  }

  // Henüz denenmemiş kaynakları (en fazla 12) çöz
  cands.filter((c) => !s.probed.has(c.url)).slice(0, Math.max(0, 12 - s.probed.size)).forEach((c) => probeCandidate(c, snap));
  renderSniffList(cands, snap);
}

async function probeCandidate(c, snap) {
  const s = sniff;
  const entry = { state: 'pending', ref: c.page ? undefined : refererFor(c, snap), at: Date.now() };
  s.probed.set(c.url, entry);
  try {
    entry.meta = await request('/api/resolve', { url: c.url, referer: entry.ref });
    entry.state = 'ok';
  } catch (err) { entry.state = 'bad'; entry.err = err.message; }
  if (sniff !== s) return;
  if (entry.state === 'ok' && !s.manual) autoPick(s);
  renderSniffList(s.snap.candidates.slice().sort((a, b) => rank(a) - rank(b)), s.snap);
}

// Reklam gibi kısa videolar yerine çözülenler arasında en uzun olanı seç
function autoPick(s) {
  const page = s.snap && s.probed.get(s.snap.pageUrl);
  if (page && page.state === 'ok') return pickSource(s.snap.pageUrl, s, false);
  const ok = [...s.probed].filter(([, e]) => e.state === 'ok');
  if (!ok.length) return;
  ok.sort((a, b) => (b[1].meta.duration || 0) - (a[1].meta.duration || 0));
  pickSource(ok[0][0], s, false);
}

function pickSource(url, s, manual) {
  const e = s.probed.get(url);
  if (!e || e.state !== 'ok') return;
  if (manual) s.manual = true;
  s.picked = url;
  // Doğrudan akışlarda yt-dlp'nin başlığı anlamsızdır ("master" gibi); sayfa başlığını kullan
  const isPage = url === s.snap.pageUrl;
  current = { ...e.meta, url, referer: e.ref, title: isPage ? e.meta.title : (s.snap.title || e.meta.title), fromSniff: !isPage };
  renderResult(current);
  setStatus('');
}

function renderSniffList(cands, snap) {
  const s = sniff;
  sniffList.textContent = '';
  if (s.probed.has(snap.pageUrl)) cands = [{ url: snap.pageUrl, kind: 'page', page: true }, ...cands.filter((c) => c.url !== snap.pageUrl)];
  // Çözülenler (gerçek video/ses) üstte, denenmemişler ortada, başarısızlar sonda
  const stateOrder = (c) => { const e = s.probed.get(c.url); return e && e.state === 'ok' ? 0 : e && e.state === 'bad' ? 2 : 1; };
  cands = cands.map((c, i) => ({ c, i })).sort((x, y) => stateOrder(x.c) - stateOrder(y.c) || x.i - y.i).map((x) => x.c);
  // Facebook gibi sitelerde yüzlerce adres olabilir: en olası 8'ini göster, gerisi tek tıkla açılır
  const total = cands.length;
  let shown = s.showAll ? cands : cands.slice(0, 8);
  const picked = cands.find((c) => c.url === s.picked);
  if (picked && !shown.includes(picked)) shown = [picked, ...shown];
  shown.forEach((c) => {
    const e = s.probed.get(c.url);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'src' + (s.picked === c.url ? ' sel' : '') + (e && e.state === 'bad' ? ' bad' : '');
    // Ham adres yerine "bu ne?" sorusunu cevaplayan ad: tür + (biliniyorsa) süre/kalite/boyut
    const m = (c.mime || '').toLowerCase();
    let type = KIND_LABEL[c.kind] || c.kind;
    if (MANIFEST_RE.test(c.url) || /mpegurl|dash/.test(m)) type = 'Yayın akışı';
    else if (m.startsWith('audio/')) type = 'Ses dosyası';
    else if (m.startsWith('video/')) type = 'Video dosyası';
    const parts = [];
    if (e && e.state === 'ok') {
      const h = e.meta.options && e.meta.options[0] && e.meta.options[0].height;
      type = h ? 'Video' : (e.meta.duration ? 'Sadece ses' : type);
      if (e.meta.duration) parts.push(fmtDuration(e.meta.duration));
      if (h) parts.push(h + 'p');
    }
    if (!parts.length) {
      try { parts.push(new URL(c.url).hostname.split('.').slice(-2).join('.')); } catch { parts.push('?'); }
      if (e && e.state === 'pending') parts.push('inceleniyor…');
    }
    const tag = document.createElement('small');
    tag.textContent = type;
    const text = parts.join(' · ');
    const extra = '';
    b.append(tag, document.createTextNode(text + extra));
    b.title = e && e.state === 'bad' ? c.url + '\n\n' + e.err : c.url; // başarısız kaynakta fare üstüne gelince hata görünür
    b.addEventListener('click', async () => {
      if (!s.probed.has(c.url) || s.probed.get(c.url).state === 'bad') { s.probed.delete(c.url); await probeCandidate(c, snap); }
      pickSource(c.url, s, true);
      renderSniffList(cands, snap);
    });
    sniffList.appendChild(b);
  });
  if (!s.showAll && total > 8) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'link';
    more.textContent = 'Diğer ' + (total - 8) + ' kaynağı göster';
    more.addEventListener('click', () => { s.showAll = true; renderSniffList(cands, snap); });
    sniffList.appendChild(more);
  }
}

sniffBtn.addEventListener('click', startSniff);
$('sniffStop').addEventListener('click', async () => {
  if (!sniff) return;
  try { await request('/api/sniff/' + sniff.id + '/stop', {}); } catch {}
  stopSniffPolling();
  sniffText.textContent = 'Pencere kapatıldı. Listeden bir kaynak seçebilirsin.';
});


// ---------- 5) Yerel kullanım: sekmeler, geçmiş, ayarlar ----------
// Bu uçlar yalnızca bilgisayarda çalışan uygulamada vardır; herkese açık sitede /api/settings 404 verir ve sekmeler gizli kalır.
const views = { download: $('view-download'), history: $('view-history'), settings: $('view-settings') };

function showView(name) {
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.view === name));
  if (name === 'history') refreshHistory();
  if (name === 'settings') loadSettings();
}
document.querySelectorAll('#tabs .tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
(async function detectLocal() {
  try { await request('/api/settings'); $('tabs').hidden = false; $('updateLink').hidden = false; } catch { return; }
  bannerCheck();
  // Tepsi menüsü doğrudan Ayarlar'ı (ve güncelleme denetimini) açabilir: ?view=settings&check=1
  const q = new URLSearchParams(location.search);
  if (q.get('update')) openUpdateModal();
})();

const fmtDate = (ms) => {
  const d = new Date(ms);
  return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
};

// --- Geçmiş ---
async function refreshHistory() {
  let list;
  try { list = await request('/api/history'); } catch { return; }
  const box = $('historyList');
  box.textContent = '';
  $('historyEmpty').hidden = list.length > 0;
  $('historyClear').hidden = list.length === 0;
  list.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'hitem' + (h.exists ? '' : ' gone');
    const t = document.createElement('div');
    t.className = 'ht'; t.textContent = h.title || 'Video';
    const m = document.createElement('div');
    m.className = 'hm';
    m.textContent = [h.mode === 'mp3' ? 'MP3' : (h.height ? h.height + 'p MP4' : 'MP4'), fmtBytes(h.size), fmtDate(h.at)].filter(Boolean).join(' · ')
      + (h.exists ? '' : ' · dosya yerinde değil (silinmiş ya da taşınmış)');
    const a = document.createElement('div');
    a.className = 'ha';
    const btn = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = text; b.addEventListener('click', fn); return b; };
    if (h.exists) {
      a.appendChild(btn('Aç', () => request('/api/history/open', { id: h.id }).catch(() => {})));
      a.appendChild(btn('Klasörde göster', () => request('/api/history/reveal', { id: h.id }).catch(() => {})));
    }
    a.appendChild(btn('Listeden sil', async () => { await request('/api/history/delete', { id: h.id }).catch(() => {}); refreshHistory(); }));
    el.append(t, m, a);
    box.appendChild(el);
  });
}
$('historyClear').addEventListener('click', async () => {
  if (!confirm('Geçmiş listesi temizlensin mi? (İndirilen dosyalar silinmez.)')) return;
  await request('/api/history/clear', {}).catch(() => {});
  refreshHistory();
});

// --- Ayarlar ---
let settingsLoaded = null;
function settingsMsg(text, isErr) {
  const el = $('settingsStatus');
  el.textContent = text || '';
  el.className = 'status' + (isErr ? ' error' : '');
}
async function loadSettings() {
  try {
    const s = await request('/api/settings');
    settingsLoaded = s;
    $('setDir').value = s.downloadDir;
    $('setParallel').value = String(s.maxParallel);
    $('setNotify').checked = s.notify;
    $('setAutoUpdate').checked = s.autoUpdateYtdlp;
    $('appVersionInfo').textContent = 'Kurulu sürüm: ' + (s.appVersion || 'bilinmiyor');
    $('setCheckApp').checked = s.checkAppUpdate;
    $('ytdlpInfo').textContent = 'Sürüm: ' + (s.ytdlpVersion || 'bilinmiyor') + (s.lastYtdlpCheck ? ' · son denetim: ' + fmtDate(s.lastYtdlpCheck) : '');
    $('pickDir').hidden = !(window.chrome && window.chrome.webview); // klasör seçme penceresi yalnızca uygulama penceresinde var
  } catch (e) { settingsMsg(e.message, true); }
}
async function saveSettings(patch, okText) {
  try { await request('/api/settings', patch); settingsMsg(okText || 'Kaydedildi ✓'); await loadSettings(); }
  catch (e) { settingsMsg(e.message, true); await loadSettings(); }
}
$('saveDir').addEventListener('click', () => saveSettings({ downloadDir: $('setDir').value.trim() }, 'İndirme klasörü kaydedildi ✓ Yeni indirmeler oraya gidecek.'));
$('defaultDir').addEventListener('click', () => { if (settingsLoaded) saveSettings({ downloadDir: settingsLoaded.defaultDir }, 'Varsayılan klasöre dönüldü ✓'); });
$('openDir').addEventListener('click', () => request('/api/open-folder', {}).catch(() => {}));
$('setParallel').addEventListener('change', (e) => saveSettings({ maxParallel: parseInt(e.target.value, 10) }, 'Kaydedildi ✓ Fazla indirmeler sırada bekler.'));
$('setNotify').addEventListener('change', (e) => saveSettings({ notify: e.target.checked }));
$('setCheckApp').addEventListener('change', (e) => saveSettings({ checkAppUpdate: e.target.checked }));

// --- VideoIndir'in kendi güncellemesi: GitHub'daki son sürümü denetle, yenilikleri özetle, istersen uygula ---
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
let updInfo = null;

function renderUpdate(r) {
  updInfo = r;
  $('updVersions').textContent = '';
  const line = (label, value, bold) => {
    const d = document.createElement('div');
    if (bold) d.style.fontWeight = '600';
    d.textContent = label + value;
    $('updVersions').appendChild(d);
  };
  line('Kurulu sürüm: ', r.current, false);
  line('En son sürüm: ', r.latest + (r.available && r.date ? '  (' + fmtDay(r.date) + ')' : ''), true);
  const notes = $('updNotes');
  notes.textContent = '';
  const p = (text, cls) => { const e = document.createElement('p'); if (cls) e.className = cls; e.textContent = text; notes.appendChild(e); };
  const status = $('updStatus');
  status.className = 'upd-status';
  $('updApply').hidden = true;
  if (!r.available) {
    p('VideoIndir zaten güncel. Yapılacak bir şey yok.');
    status.textContent = 'Güncelsin ✓';
    status.classList.add('ok');
    return;
  }
  p('Kurulu sürümünden bu yana ' + r.releases.length + ' güncelleme yayınlandı. Neler değişti:');
  r.releases.forEach((rel) => {
    p('Sürüm ' + rel.version, 'uver');
    const ul = document.createElement('ul');
    (rel.notes.length ? rel.notes : ['Küçük düzeltmeler ve iyileştirmeler.']).forEach((n) => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
    notes.appendChild(ul);
  });
  if (r.dev) { status.textContent = 'Bu bir geliştirme klasörü; kendini güncellemez.'; return; }
  if (!r.canPatch) { status.textContent = 'Bu sürümde otomatik yama yok. Aşağıdaki bağlantıdan yeni zip dosyasını indir.'; $('updAll').href = r.url; return; }
  status.textContent = 'Yeni sürüm hazır' + (r.patchSize ? ' · indirme boyutu ' + Math.max(1, Math.round(r.patchSize / 1024)) + ' KB' : '');
  $('updApply').hidden = false;
  $('updApply').disabled = false;
}

async function runUpdateCheck(force) {
  $('updRecheck').disabled = true;
  $('updStatus').className = 'upd-status';
  $('updStatus').textContent = 'GitHub denetleniyor…';
  try { renderUpdate(await request('/api/update/check' + (force ? '?force=1' : ''))); }
  catch (e) { $('updStatus').className = 'upd-status error'; $('updStatus').textContent = e.message; }
  finally { $('updRecheck').disabled = false; }
}

function openUpdateModal() {
  $('updateModal').hidden = false;
  $('updVersions').textContent = '';
  $('updNotes').textContent = '';
  runUpdateCheck(true);
}
const closeUpdateModal = () => { $('updateModal').hidden = true; };

async function applyAppUpdate(force) {
  const btn = $('updApply');
  btn.disabled = true;
  try {
    await request('/api/update/apply', { force });
    $('updStatus').className = 'upd-status';
    $('updStatus').textContent = 'Güncelleniyor… uygulama birkaç saniye içinde kapanıp yeniden açılacak.';
    $('updRecheck').disabled = true;
  } catch (e) {
    btn.disabled = false;
    if (e.status === 409) {
      if (confirm(e.message + ' Yine de güncellensin mi?')) applyAppUpdate(true);
    } else { $('updStatus').className = 'upd-status error'; $('updStatus').textContent = e.message; }
  }
}

$('updateLink').addEventListener('click', openUpdateModal);
$('appCheck').addEventListener('click', openUpdateModal);
$('updRecheck').addEventListener('click', () => runUpdateCheck(true));
$('updClose').addEventListener('click', closeUpdateModal);
$('updApply').addEventListener('click', () => applyAppUpdate(false));
$('updateModal').addEventListener('click', (e) => { if (e.target === $('updateModal')) closeUpdateModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('updateModal').hidden) closeUpdateModal(); });
$('updateBannerBtn').addEventListener('click', openUpdateModal);

// Sayfa açılınca sessizce denetle: yeni sürüm varsa üstte şerit göster (Ayarlar'dan kapatılabilir)
async function bannerCheck() {
  try {
    const s = await request('/api/settings');
    if (!s.checkAppUpdate) return;
    const r = await request('/api/update/check');
    if (r.available && !r.dev) {
      $('updateBannerText').textContent = 'Yeni sürüm hazır: ' + r.latest + '.';
      $('updateBanner').hidden = false;
    }
  } catch {}
}

$('setAutoUpdate').addEventListener('change', (e) => saveSettings({ autoUpdateYtdlp: e.target.checked }));
$('ytdlpUpdate').addEventListener('click', async () => {
  const b = $('ytdlpUpdate');
  b.disabled = true;
  settingsMsg('İndirme aracı denetleniyor… bu birkaç dakika sürebilir.');
  try { const r = await request('/api/ytdlp/update', {}); settingsMsg(r.message, r.ok === false && !r.busy); }
  catch (e) { settingsMsg(e.message, true); }
  finally { b.disabled = false; loadSettings(); }
});
// Uygulama penceresinde klasör seçme penceresi (exe açar, seçilen yolu geri yollar)
if (window.chrome && window.chrome.webview) {
  window.chrome.webview.addEventListener('message', (e) => {
    if (typeof e.data === 'string' && e.data) { $('setDir').value = e.data; saveSettings({ downloadDir: e.data }, 'İndirme klasörü kaydedildi ✓ Yeni indirmeler oraya gidecek.'); }
  });
  $('pickDir').addEventListener('click', () => window.chrome.webview.postMessage('pickFolder'));
}
