# Gelişmiş

## Nasıl çalışır
`VideoIndir.exe` küçük bir yerel servisi (`helper\server.js`, Node.js) arka planda başlatır; servis `yt-dlp` ve `ffmpeg`'i çalıştırır. Arayüz bu servisin sunduğu sayfadır (`http://127.0.0.1:9696`), exe bunu küçük bir Edge uygulama penceresinde açar. Tarayıcı eklentisi de aynı servisle konuşur. Servis yalnızca bu bilgisayardan erişilebilir.

## Firefox
Firefox farklı bir paket ister. Node.js kuruluyken `tools\Firefox-Hazirla.bat` çalıştır, sonra Firefox'ta `about:debugging#/runtime/this-firefox` → **Geçici Eklenti Yükle** → `extension-firefox\manifest.json`. Firefox kapanınca eklenti kalkar; kalıcı kurulum için imzalama gerekir.

## Çerezler (giriş isteyen siteler)
`helper\cookies.txt` (Netscape biçimi) koyarsan servis bunu kullanır. Kendi hesabının çerezlerini paylaştığın biriyle/yerde kullanma.

## Siteyi internete açma (isteğe bağlı)
`tools\Internete-Ac.bat` Cloudflare Tunnel ile geçici bir adres açar. Linki bilen herkes bilgisayarın üzerinden indirme yapabilir; dikkatli kullan. Ortam değişkenleri: `VI_PUBLIC`, `VI_HOST`, `VI_PORT`, `VI_ALLOWED_HOSTS`, `VI_TRUST_PROXY`, `VI_MAX_DURATION`, `VI_MAX_JOBS`, `VI_MAX_FILESIZE` (kaynak: `helper\server.js`, `helper\web.js`). Herkese açık modda eklenti uçları ve sayfadan akış yakalama kapalıdır.

## Kaynaktan derleme
Gerekenler: Windows, Node.js. C# derleyicisi Windows'ta hazır gelir.

```
launcher\build.bat                      # VideoIndir.exe'yi derler
node tools\package-release.js           # dist\VideoIndir-vX.Y.Z.zip paketini üretir
```

Klasörler: `launcher\` exe'nin kaynağı (C#) · `helper\` servis ve web arayüzü · `extension\` tarayıcı eklentisi · `tools\` yardımcı betikler.
