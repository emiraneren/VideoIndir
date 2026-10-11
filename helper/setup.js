// İlk kurulum: yt-dlp ve ffmpeg'i resmi GitHub sürümlerinden helper\bin klasörüne indirir.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, 'bin');
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';

async function download(url, dest, label) {
  process.stdout.write(`${label} indiriliyor... `);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log('tamam');
}

(async () => {
  fs.mkdirSync(BIN, { recursive: true });

  const ytdlp = path.join(BIN, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlp)) await download(YTDLP_URL, ytdlp, 'yt-dlp');
  else console.log('yt-dlp zaten var.');

  if (!fs.existsSync(path.join(BIN, 'ffmpeg.exe'))) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'videoindir-'));
    const zip = path.join(tmp, 'ffmpeg.zip');
    await download(FFMPEG_URL, zip, 'ffmpeg');
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
