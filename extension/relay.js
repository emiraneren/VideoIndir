// hook.js sayfanın dünyasından postMessage ile haber verir; bu betik mesajı eklentinin arka planına iletir.
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.__vi !== 1) return;
  const urls = Array.isArray(d.urls) ? d.urls.filter((u) => typeof u === 'string').slice(0, 30) : [];
  try { chrome.runtime.sendMessage({ type: 'found', urls, mse: !!d.mse }); } catch {}
});
