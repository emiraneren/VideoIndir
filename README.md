# VideoIndir

YouTube, Instagram, Facebook, TikTok, X ve 1000'den fazla sitedeki videoyu istediğin kalitede (MP4) ya da **MP3** olarak indirir. Windows için.

## Kurulum

1. [**Releases**](../../releases/latest) sayfasından `VideoIndir-vX.Y.Z.zip` dosyasını indir ve bir klasöre çıkar (masaüstü olabilir).
2. `VideoIndir.exe`'yi çift tıkla.
   - Windows *"Bilgisayarınızı korudu"* derse: **Ek bilgi → Yine de çalıştır**. (Uygulama imzalı değil, bu uyarı normaldir.)
3. İlk açılışta `yt-dlp` ve `ffmpeg` bir kez indirilir (~180 MB, ilerleme çubuğu görünür). Sonra küçük bir pencere açılır.

Ayrıca bir şey kurman gerekmez. Uygulama kendi küçük penceresinde açılır (tarayıcı gerekmez). Sağ alttaki tepsi simgesi uygulamanın çalıştığını gösterir; kapatmak için simgeye sağ tık → **Çıkış**.

Zip'in içinde yalnızca şunlar var (gerisi `app` klasöründe). Kurulum yok, klasör olduğu gibi çalışır:

| Dosya | Ne işe yarar |
|---|---|
| `VideoIndir.exe` | Uygulama |
| `BENIOKU.txt` | Kısa kullanım ve eklenti anlatımı |
| `Kaldir.exe` | Uygulamayı tamamen kaldırır (indirdiğin videolara dokunmaz) |

## Kullanım

- **Yapıştır**'a bas (ya da bağlantıyı kutuya yapıştır), kaliteyi ya da **MP3**'ü seç. Dosya doğrudan indirme klasörüne kaydedilir; bitince **Klasörde göster** ve **Aç** düğmeleri çıkar, sağ altta bildirim gelir.
- Tarayıcıda video izlerken **Ctrl+Alt+D**'ye basarsan bağlantı kendiliğinden gelir.
- İndirmeyi **Duraklat** (sonra **Devam et**: kaldığı yerden sürer) ya da **İptal** edebilirsin. Aynı düğmeler tarayıcı eklentisinde de var.
- Bağlantı çözülmüyorsa (video sayfanın içinde gizliyse): **"Çözülmüyor mu? Sayfayı açıp videoyu bul"** → açılan pencerede videoyu oynat, bulunan kaynak listelenir.

Üstteki sekmeler:

- **Geçmiş:** indirdiklerin; buradan açabilir ya da klasörde gösterebilirsin (listeden silmek dosyayı silmez).
- **Ayarlar:** indirme klasörü (varsayılan `İndirilenler\VideoIndir`), aynı anda en fazla kaç indirme (fazlası sırada bekler), bildirimler ve indirme aracının (yt-dlp) güncellenmesi. Siteler değiştikçe araç eskir; uygulama günde bir kendiliğinden günceller, hata verirse de otomatik güncellemeyi dener.

Pencereyi kapatırsan uygulama tepside çalışmaya devam eder. Kapalıyken eklenti ya da simge ile tekrar açılır.

**Güncelleme:** Uygulamanın sağ üstündeki **Güncellemeleri denetle** (ya da tepsi simgesine sağ tık → **Güncellemeleri denetle…**). GitHub'daki son sürüme bakar, **yeni gelenleri özetler**, istersen tek tıkla küçük yamayı indirip uygular ve uygulamayı yeniden açar. Yeni sürüm çıkınca ayrıca bildirim gelir (Ayarlar'dan kapatılabilir). İlk açılışta indirilen `yt-dlp`/`ffmpeg` korunur.

## Tarayıcı eklentisi (isteğe bağlı)

Eklenti, tarayıcıda videoyu izlerken simgeye tıklayıp indirmeni sağlar. **Exe açıkken** çalışır.

1. Tarayıcında eklenti sayfasını aç: `chrome://extensions` (Opera: `opera://extensions`, Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle**'ye (Opera'da *Load unpacked*) tıkla ve `app\extension` klasörünü seç.
4. Simgeyi araç çubuğuna sabitle.

Kolay yol: exe'nin tepsi simgesine sağ tık → **Tarayıcı eklentisi** → tarayıcını seç. Sayfayı ve klasörü açar.

Gizli pencerede kullanmak için eklentinin ayrıntılarında **Gizli modda izin ver**'i aç.

## Sık sorunlar

| Sorun | Çözüm |
|---|---|
| Eklenti "VideoIndir uygulaması kapalı" diyor | Eklentideki **Uygulamayı aç** düğmesine bas ya da `VideoIndir.exe`'yi çalıştır. |
| Facebook / Instagram'da "Video çözülemedi" | Video giriş istiyor olabilir. **"Çözülmüyor mu? Sayfayı açıp videoyu bul"**'a bas, açılan pencerede siteye **bir kez giriş yap**. Uygulama otomatik devam eder ve giriş hatırlanır. |
| Açılan pencere giriş istiyor | Bu pencere ayrı bir profil kullanır; normal tarayıcındaki giriş orada görünmez (tarayıcılar çerezleri başka programlara vermez). **Bir kez** giriş yap, sonra hatırlanır. Hazır oturumunu kullanmak istersen tarayıcı eklentisini kur. |
| Özel / kaldırılmış video | İndirilemez. |
| YouTube "bot" diyor | Biraz bekleyip tekrar dene. |
| Antivirüs uyarı verdi | Uygulama imzasız; klasörü antivirüste güvenli listeye ekle. |

Gelişmiş konular (Firefox, siteyi internete açma, kaynaktan derleme): [docs/GELISMIS.md](docs/GELISMIS.md)

## Yasal not

Bu araç yalnızca indirme hakkına sahip olduğun içerikler içindir. Platformların kullanım koşulları ve telif hakkı kurallarına uymak senin sorumluluğundadır. İndirme işini [yt-dlp](https://github.com/yt-dlp/yt-dlp) ve [ffmpeg](https://ffmpeg.org) yapar.
