// Hem popup'ta hem arka plan servis çalışanında kullanılan ortak yardımcılar.
const API = 'http://127.0.0.1:9696';

// timeoutMs verilirse istek o süre içinde bitmezse "Zaman aşımı" hatasıyla düşer (popup takılı kalmasın diye)
async function api(path, body, timeoutMs) {
  const ctl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  try {
    const res = await fetch(API + path, {
      signal: ctl.signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    return data;
  } catch (e) {
    throw e.name === 'AbortError' ? new Error('Zaman aşımı') : e;
  } finally { clearTimeout(timer); }
}

// Söz verilen sürede bitmezse yedek değeri döndürür; bir adım takılırsa akış devam eder
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))]);

const isHttp = (u) => /^https?:\/\//i.test(u || '');

// Yerel/özel ağ adresleri video kaynağı olamaz; bir sayfanın yt-dlp'yi iç ağa yönlendirmesini de engeller
function isPrivateHost(url) {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0'
      || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h);
  } catch { return true; }
}

// Girişli (üyelik isteyen) videolar için tarayıcının çerezlerini Netscape biçiminde toplar.
// Yalnızca yerel yardımcıya gider; yt-dlp bunları sadece ilgili sitelere gönderir.
async function collectCookies(urls, tabId) {
  // Gizli sekmelerin çerezleri ayrı bir depoda durur; tarayıcının varsayılan deposuna bakmak yanlış oturumu verir
  let storeId;
  try {
    const stores = await chrome.cookies.getAllCookieStores();
    const s = stores.find((x) => x.tabIds.includes(tabId));
    if (s) storeId = s.id;
  } catch {}
  const seen = new Map();
  for (const u of urls.filter(isHttp)) {
    try {
      for (const c of await chrome.cookies.getAll(storeId ? { url: u, storeId } : { url: u })) {
        seen.set(`${c.domain}|${c.path}|${c.name}`, c);
      }
    } catch {}
  }
  const clean = (s) => String(s).replace(/[\t\r\n]/g, '');
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of seen.values()) {
    lines.push([
      (c.httpOnly ? '#HttpOnly_' : '') + clean(c.domain),
      c.domain.startsWith('.') ? 'TRUE' : 'FALSE',
      clean(c.path),
      c.secure ? 'TRUE' : 'FALSE',
      c.expirationDate ? Math.floor(c.expirationDate) : 0,
      clean(c.name),
      clean(c.value),
    ].join('\t'));
  }
  return lines.length > 1 ? lines.join('\n') + '\n' : '';
}

// Bir kaynak için yt-dlp'ye gidecek ortak istek bilgisi
async function requestContext(srcUrl, tabUrl, tabId) {
  return { ua: navigator.userAgent, cookies: await collectCookies([srcUrl, tabUrl], tabId) };
}
