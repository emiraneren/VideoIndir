// Arka plan: sekmelerin ağ trafiğinden video kaynaklarını toplar, sağ tık menüsünü yönetir.
// Chromium'da service worker olarak çalışır (importScripts var); Firefox'ta common.js manifest'teki scripts listesiyle önce yüklenir.
if (typeof importScripts === 'function') importScripts('common.js');

const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i;
const FILE_RE = /\.(mp4|webm|m4v|mov|mkv|mp3|m4a|flv|ogg|opus|wav)(\?|#|$)/i;
// Parça (segment) dosyaları tek başına anlamsızdır; listeyi doldurmasınlar
const SEGMENT_RE = /\.(ts|m4s|cmfv|cmfa|aac)(\?|#|$)|[-_/](seg|segment|chunk|frag|fragment)[-_]?\d+|[?&](range|bytestart|sq|rn)=/i;
const SKIP_HOST_RE = /googlevideo\.com$/i; // YouTube'un parça adresleri; YouTube'u sayfa adresi çözer
const MAX_PER_TAB = 25;
const MIN_FILE_BYTES = 300000; // arayüz sesleri/reklam görselleri gibi küçük medya dosyalarını ele

const key = (tabId) => 't' + tabId;

// Service worker uykuya dalabilir; yazmaları sıraya koyup storage.session'da saklıyoruz.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

function setBadge(tabId, n) {
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  if (n) chrome.action.setBadgeBackgroundColor({ tabId, color: '#e11d48' }).catch(() => {});
}

// Aynı yolun farklı token'lı adreslerini tek kaynak say (uzantılı akışlarda); uzantısız adreslerde tam adres
function dedupeKey(url) {
  try {
    const u = new URL(url);
    return MANIFEST_RE.test(url) || FILE_RE.test(url) ? u.origin + u.pathname : url;
  } catch { return url; }
}

// Akışı gerçekte isteyen sayfa (çoğu zaman iframe'deki oynatıcı); CDN'ler Referer olarak bunu bekler
const refOf = (d) => d.documentUrl || (d.initiator && d.initiator !== 'null' ? d.initiator + '/' : undefined);

function addFound(tabId, url, src, extra) {
  if (tabId < 0 || !isHttp(url) || isPrivateHost(url)) return;
  let host = '';
  try { host = new URL(url).hostname; } catch { return; }
  if (SKIP_HOST_RE.test(host)) return;
  enqueue(async () => {
    const k = key(tabId);
    const list = (await chrome.storage.session.get(k))[k] || [];
    const dk = dedupeKey(url);
    const entry = { url, at: Date.now(), src, ...(extra && extra.ref ? { ref: extra.ref } : {}), ...(extra && extra.size ? { size: extra.size, type: extra.type } : {}) };
    const i = list.findIndex((x) => dedupeKey(x.url) === dk);
    if (i >= 0) list[i] = { ...list[i], ...entry, at: list[i].at }; else list.push(entry);
    const trimmed = list.slice(-MAX_PER_TAB);
    await chrome.storage.session.set({ [k]: trimmed });
    setBadge(tabId, trimmed.length);
  });
}

// 1) Adres uzantısından (istek anında)
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (!MEDIA_URL(d.url)) return;
  addFound(d.tabId, d.url, 'net', { ref: refOf(d) });
}, { urls: ['<all_urls>'] });

function MEDIA_URL(url) {
  return (MANIFEST_RE.test(url) || FILE_RE.test(url)) && !SEGMENT_RE.test(url);
}

// 2) Cevap başlıklarından: uzantısız adresler (CDN, token'lı yollar) yine de video/ses/manifest Content-Type'ı taşır
chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.statusCode >= 400 || MEDIA_URL(d.url) || SEGMENT_RE.test(d.url)) return;
  const h = (n) => ((d.responseHeaders || []).find((x) => x.name.toLowerCase() === n) || {}).value || '';
  const ct = h('content-type').toLowerCase();
  const len = parseInt(h('content-length') || String(h('content-range')).split('/')[1] || '0', 10) || 0;
  const manifest = /mpegurl|dash\+xml/.test(ct);
  const media = /^(video|audio)\//.test(ct);
  if (!manifest && !media) return;
  if (media && len && len < MIN_FILE_BYTES) return;
  addFound(d.tabId, d.url, 'net', { type: ct, size: len, ref: refOf(d) });
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

// 3) Sayfa içi kancalardan (API cevapları, base64, MediaSource)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'found' || !sender.tab) return;
  const tabId = sender.tab.id;
  (msg.urls || []).forEach((u) => addFound(tabId, u, 'hook', {}));
  if (msg.mse) enqueue(() => chrome.storage.session.set({ ['m' + tabId]: true }));
});

// Sayfa değişince eski sekmenin listesini temizle
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' && change.url) {
    enqueue(async () => { await chrome.storage.session.remove([key(tabId), 'm' + tabId]); setBadge(tabId, 0); });
  }
});
chrome.tabs.onRemoved.addListener((tabId) => enqueue(() => chrome.storage.session.remove([key(tabId), 'm' + tabId])));

// ---------- Sağ tık menüsü ----------
// Sitelerin kendi indirme düğmesi yoksa: videoya, bağlantıya ya da sayfaya sağ tıkla → VideoIndir ile indir.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'vi-media', title: 'VideoIndir ile indir', contexts: ['video', 'audio', 'link'] });
    chrome.contextMenus.create({ id: 'vi-page', title: 'Bu sayfadaki videoyu VideoIndir ile indir', contexts: ['page', 'frame'] });
  });
});

function flash(tabId, text, color) {
  if (tabId == null || tabId < 0) return;
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  setTimeout(() => chrome.storage.session.get(key(tabId)).then((s) => setBadge(tabId, (s[key(tabId)] || []).length)), 4000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabUrl = tab && tab.url;
  // blob: adresleri indirilemez; o durumda sayfanın/çerçevenin adresine düş
  let url = info.menuItemId === 'vi-media' ? (info.srcUrl || info.linkUrl) : (info.frameUrl || info.pageUrl);
  if (!isHttp(url)) url = info.linkUrl && isHttp(info.linkUrl) ? info.linkUrl : (info.frameUrl || info.pageUrl || tabUrl);
  if (!isHttp(url) || isPrivateHost(url)) return flash(tab && tab.id, '!', '#e11d48');
  try {
    const ctx = await requestContext(url, tabUrl, tab.id);
    const base = { url, referer: tabUrl, ...ctx };
    const meta = await api('/info', base);
    await api('/download', { ...base, profile: meta.profile, mode: 'video', title: url === tabUrl ? undefined : tab.title });
    flash(tab.id, '↓', '#16a34a');
  } catch { flash(tab && tab.id, '!', '#e11d48'); }
});
