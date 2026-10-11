// Sayfanın kendi JavaScript dünyasında (MAIN) çalışır. Sayfa video adresini bir API cevabından,
// base64 içinden veya MediaSource ile "blob:" olarak alıyorsa ağ dinleyicisinin göremediği ipuçlarını yakalar.
(() => {
  if (window.__viHooked) return;
  window.__viHooked = true;

  const RE = /(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|webm|m4v|mov|mkv|mp3|m4a)(?:\?[^\s"'<>\\]*)?(?=$|[\s"'<>\\])/gi;
  const seen = new Set();
  let queued = [];
  let timer = 0;

  const post = (msg) => window.postMessage({ __vi: 1, ...msg }, '*');

  function flush() {
    timer = 0;
    if (queued.length) post({ urls: queued.splice(0, 30) });
  }

  function scan(text) {
    if (typeof text !== 'string' || text.length < 12 || text.length > 3e6) return;
    // JSON içinde kaçışlı yazılmış adresleri düzelt: https:\/\/x.com\/a.mp4?a=1&b=2
    const t = text.replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
    for (const m of t.match(RE) || []) {
      let u;
      try { u = new URL(m, location.href).href; } catch { continue; }
      if (!/^https?:/.test(u) || seen.has(u)) continue;
      seen.add(u);
      queued.push(u);
    }
    if (queued.length && !timer) timer = setTimeout(flush, 300);
  }

  // fetch cevapları (JSON/metin API'leri). Manifest dosyalarının kendisi atlanır, onları ağ dinleyicisi zaten görür.
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((r) => {
        const ct = r.headers.get('content-type') || '';
        const len = parseInt(r.headers.get('content-length') || '0', 10);
        if (/json|text|javascript/i.test(ct) && !/mpegurl|dash/i.test(ct) && len < 2e6) r.clone().text().then(scan, () => {});
      }, () => {});
      return p;
    };
  }

  // XMLHttpRequest cevapları
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (/mpegurl|dash/i.test(ct)) return;
        if (this.responseType === '' || this.responseType === 'text') scan(this.responseText);
        else if (this.responseType === 'json' && this.response) scan(JSON.stringify(this.response));
      } catch {}
    });
    return origSend.apply(this, args);
  };

  // Adresi gizlemek için base64'e koyan sayfalar
  const origAtob = window.atob;
  window.atob = function (s) {
    const out = origAtob.call(this, s);
    try { scan(out); } catch {}
    return out;
  };

  // MediaSource kullanılıyorsa video "blob:" olarak oynar; doğrudan indirilemez, kayıt yöntemi gerekebilir
  if (window.MediaSource && MediaSource.prototype.addSourceBuffer) {
    const origAdd = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (...args) {
      post({ mse: true });
      return origAdd.apply(this, args);
    };
  }
})();
