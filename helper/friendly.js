// Teknik hata metinlerini, işten anlamayan birinin okuyunca direkt anlayacağı Türkçeye çevirir:
// "ne oldu" + "ne yapmalı". Ham (teknik) metin ayrıntı olarak ayrıca döner, arayüzde gizli tutulur.
//
// Sıra önemlidir: ilk eşleşen kural kazanır.
const RULES = [
  // [desen, kod, mesaj]
  [/sign in to confirm you.re not a bot|not a bot|confirm you.re not a robot/i, 'bot',
    'YouTube şu an isteği "robot" sandı ve engelledi. Birkaç dakika bekleyip tekrar dene.'],

  [/private video|members.only|\blog ?in\b|sign in|cookies|authenticat|age.?restrict|confirm your age|requires? (a )?(account|subscription)|cannot parse data|empty media response|checkpoint|http error 403|forbidden|login required/i, 'login',
    'Bu video giriş gerektiriyor (özel, grup içi ya da yaş sınırlı). Uygulamada "Çözülmüyor mu? Sayfayı açıp videoyu bul" düğmesine bas ve açılan pencerede siteye bir kez giriş yap.'],

  [/this live event|is live|live stream|premieres? in|will begin in|livestream/i, 'live',
    'Bu bir canlı yayın ya da henüz başlamamış bir video. Yayın bittikten sonra tekrar dene.'],

  [/no space left|disk full|errno 28|not enough space|there is not enough space/i, 'disk',
    'Bilgisayarında boş yer kalmamış. Biraz yer açıp tekrar dene.'],

  [/permission denied|access is denied|errno 13|file name too long|path too long|errno 36|cannot create|read-only|could not open file|unable to open for writing/i, 'path',
    'Dosya kaydedilemedi: klasöre yazılamıyor ya da dosya adı çok uzun. Ayarlar\'dan başka bir indirme klasörü seç.'],

  [/larger than max-filesize|max.filesize/i, 'size',
    'Dosya izin verilen boyuttan büyük. Daha düşük bir kalite seç.'],

  [/unsupported url|is not a valid url|no video formats|no video could be found|there.s no video|no suitable/i, 'unsupported',
    'Bu bağlantı bir video sayfasına benzemiyor. Videonun ya da gönderinin kendi bağlantısını yapıştır.'],

  [/unavailable|removed|deleted|not available|no longer available|copyright|geo.?restrict|country|does not exist|video not found|\b404\b/i, 'gone',
    'Video artık yok, silinmiş ya da senin ülkende izlenemiyor.'],

  [/getaddrinfo|name or service|temporary failure|network is unreachable|connection (reset|refused|aborted|error)|timed? ?out|zaman aşımı|ssl|certificate|incompleteread|remote end closed|urlopen error|unable to download/i, 'network',
    'İnternete ulaşılamadı ya da site cevap vermedi. İnternet bağlantını kontrol edip tekrar dene.'],

  [/ffmpeg|conversion failed|postprocess|merger|fixup/i, 'ffmpeg',
    'Video indi ama son işlem (birleştirme ya da dönüştürme) başarısız oldu. Tekrar dene; olmazsa başka bir kalite seç.'],

  // Site değişmiş, indirme aracı eskimiş olabilir: uygulama kendini güncelleyecek (çağıran taraf isExtractorBreak ile anlar)
  [/unable to extract|extractorerror|please report this issue|unexpected (response|error)|regex|json|parse|http error 4\d\d|http error 5\d\d/i, 'extractor',
    'Site yapısını değiştirmiş olabilir. Uygulama kendini güncelliyor; 1-2 dakika sonra tekrar dene.'],
];

const FALLBACK = 'Bu video indirilemedi. Bağlantıyı kontrol edip tekrar dene. Sorun sürerse Ayarlar\'dan "İndirme aracını güncelle"ye bas.';

// Ham mesajdaki dosya yollarını temizle (kullanıcıya iç klasörleri göstermeyelim) ve kısalt
const clean = (msg) => String(msg || '')
  .replace(/^ERROR:\s*/i, '')
  .replace(/[A-Za-z]:\\[^\s'"]*/g, '…')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 220);

function explain(msg) {
  const raw = String(msg || '');
  const hit = RULES.find(([re]) => re.test(raw));
  return { error: hit ? hit[2] : FALLBACK, code: hit ? hit[1] : 'unknown', detail: clean(raw) };
}

// Site/indirme aracı uyumsuzluğu gibi görünen hatalarda indirme aracını güncellemeyi dene
const isExtractorBreak = (msg) => ['extractor', 'unknown'].includes(explain(msg).code);

module.exports = { explain, isExtractorBreak };
