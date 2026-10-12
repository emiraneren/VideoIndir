# VideoIndir

YouTube, Instagram, Facebook, TikTok, X ve 1000'den fazla sitedeki videoyu istediğin kalitede (MP4) ya da **MP3** olarak indirir. Windows için.

## Kurulum

1. [**Releases**](../../releases/latest) sayfasından `VideoIndir-vX.Y.Z.zip` dosyasını indir ve bir klasöre çıkar (masaüstü olabilir).
2. `VideoIndir.exe`'yi çift tıkla.
   - Windows *"Bilgisayarınızı korudu"* derse: **Ek bilgi → Yine de çalıştır**. (Uygulama imzalı değil, bu uyarı normaldir.)
3. İlk açılışta `yt-dlp` ve `ffmpeg` bir kez indirilir (~180 MB). Sonra küçük bir pencere açılır.

Ayrıca bir şey kurman gerekmez. Sağ alttaki tepsi simgesi uygulamanın çalıştığını gösterir; kapatmak için simgeye sağ tık → **Çıkış**.

## Kullanım

- Video bağlantısını yapıştır, kaliteyi ya da **MP3**'ü seç, **Dosyayı indir**'e bas.
- Tarayıcıda video izlerken **Ctrl+Alt+D**'ye basarsan bağlantı kendiliğinden gelir.
- İndirmeyi **İptal** düğmesiyle durdurabilirsin.
- Bağlantı çözülmüyorsa (video sayfanın içinde gizliyse): **"Çözülmüyor mu? Sayfayı açıp videoyu bul"** → açılan pencerede videoyu oynat, bulunan kaynak listelenir.

Dosyalar `İndirilenler\VideoIndir` klasörüne kaydedilir.

**Güncelleme:** Önce tepsiden **Çıkış** yap. Releases'teki küçük **`VideoIndir-yama-...zip`** dosyasını (birkaç KB) VideoIndir klasörüne çıkar, "dosyaları değiştir" de. (Tam zip'i çıkarmak da olur.) İlk açılışta indirilen `yt-dlp`/`ffmpeg` korunur.

## Tarayıcı eklentisi (isteğe bağlı)

Eklenti, tarayıcıda videoyu izlerken simgeye tıklayıp indirmeni sağlar. **Exe açıkken** çalışır.

1. Tarayıcında eklenti sayfasını aç: `chrome://extensions` (Opera: `opera://extensions`, Brave: `brave://extensions`, Edge: `edge://extensions`).
2. Sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle**'ye (Opera'da *Load unpacked*) tıkla ve paketteki `extension` klasörünü seç.
4. Simgeyi araç çubuğuna sabitle.

Kolay yol: exe'nin tepsi simgesine sağ tık → **Tarayıcı eklentisi** → tarayıcını seç. Sayfayı ve klasörü açar.

Gizli pencerede kullanmak için eklentinin ayrıntılarında **Gizli modda izin ver**'i aç.

## Sık sorunlar

| Sorun | Çözüm |
|---|---|
| Eklenti "Yardımcı program çalışmıyor" diyor | `VideoIndir.exe` kapalı. Aç. |
| Facebook / Instagram'da "Video çözülemedi" | Video giriş istiyor olabilir. **"Çözülmüyor mu? Sayfayı açıp videoyu bul"**'a bas, açılan pencerede siteye **bir kez giriş yap**. Uygulama otomatik devam eder ve giriş hatırlanır. |
| Açılan pencere giriş istiyor | Bu pencere ayrı bir profil kullanır; normal tarayıcındaki giriş orada görünmez (tarayıcılar çerezleri başka programlara vermez). **Bir kez** giriş yap, sonra hatırlanır. Hazır oturumunu kullanmak istersen tarayıcı eklentisini kur. |
| Özel / kaldırılmış video | İndirilemez. |
| YouTube "bot" diyor | Biraz bekleyip tekrar dene. |
| Antivirüs uyarı verdi | Uygulama imzasız; klasörü antivirüste güvenli listeye ekle. |

Gelişmiş konular (Firefox, siteyi internete açma, kaynaktan derleme): [docs/GELISMIS.md](docs/GELISMIS.md)

## Yasal not

Bu araç yalnızca indirme hakkına sahip olduğun içerikler içindir. Platformların kullanım koşulları ve telif hakkı kurallarına uymak senin sorumluluğundadır. İndirme işini [yt-dlp](https://github.com/yt-dlp/yt-dlp) ve [ffmpeg](https://ffmpeg.org) yapar.
