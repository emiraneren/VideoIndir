// İlk kurulum: yt-dlp ve ffmpeg'i resmi GitHub sürümlerinden helper\bin klasörüne indirir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, 'bin');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';

// Kurulum penceresi (VideoIndir.exe) bu satırları okur: PROG|yazı|yüzde
const prog = (label, pct) => console.log(`PROG|${label}|${Math.max(0, Math.min(100, Math.round(pct)))}`);

// İndirme: toplam boyut biliniyorsa gerçek yüzde, bilinmiyorsa 0 (aralık: [lo, hi] genel ilerleme dilimi)
async function download(url, dest, label, lo, hi) {
  console.log(`${label} indiriliyor...`);
  prog(`${label} indiriliyor…`, lo);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0, lastTick = 0;
  for await (const c of res.body) {
    chunks.push(c);
    got += c.length;
    const now = Date.now();
    if (total && now - lastTick > 250) {
      lastTick = now;
      prog(`${label} indiriliyor… ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB`, lo + (hi - lo) * (got / total));
    }
  }
  fs.writeFileSync(dest, Buffer.concat(chunks));
  prog(`${label} indirildi`, hi);
  console.log('tamam');
}

(async () => {
  fs.mkdirSync(BIN, { recursive: true });

  const ytdlp = path.join(BIN, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlp)) await download(YTDLP_URL, ytdlp, 'yt-dlp', 0, 15);
  else console.log('yt-dlp zaten var.');

  if (!fs.existsSync(path.join(BIN, 'ffmpeg.exe'))) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videoindir-'));
    const zip = path.join(tmp, 'ffmpeg.zip');
    await download(FFMPEG_URL, zip, 'ffmpeg', 15, 90);
    prog('ffmpeg açılıyor…', 92);
    process.stdout.write('ffmpeg açılıyor... ');
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { stdio: 'ignore' });
    const root = fs.readdirSync(tmp).map((n) => path.join(tmp, n, 'bin')).find((p) => fs.existsSync(path.join(p, 'ffmpeg.exe')));
    if (!root) throw new Error('ffmpeg.exe zip içinde bulunamadı');
    for (const f of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(root, f), path.join(BIN, f));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('tamam');
  } else console.log('ffmpeg zaten var.');

  console.log('\nKurulum bitti.');
})().catch((e) => { console.error('\nHATA:', e.message); process.exit(1); });
