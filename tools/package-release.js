// Arkadaşlara verilecek sürüm paketini üretir: dist\VideoIndir-v<sürüm>.zip
// İçinde: VideoIndir.exe, yerleşik Node (runtime\), servis kodu (helper\), eklenti (extension\), README.
// yt-dlp ve ffmpeg pakete konmaz; exe ilk açılışta resmi sürümlerini indirir.
// Önce launcher\build.bat ile VideoIndir.exe derlenmiş olmalı.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = process.argv[2] || require(path.join(root, 'extension', 'manifest.json')).version;
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'VideoIndir');
const zip = path.join(dist, `VideoIndir-v${version}.zip`);

if (!fs.existsSync(path.join(root, 'VideoIndir.exe'))) { console.error('VideoIndir.exe yok. Önce launcher\\build.bat çalıştır.'); process.exit(1); }

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(path.join(stage, 'helper'), { recursive: true });
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(stage, to), { recursive: true });
copy('VideoIndir.exe', 'VideoIndir.exe');
// Uygulama penceresi için WebView2 DLL'leri (exe'nin yanında durmalı) ve lisansı; güncelleyici
for (const f of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) copy(f, f);
copy(path.join('launcher', 'lib', 'WEBVIEW2-LICENSE.txt'), 'WEBVIEW2-LICENSE.txt');
copy('Guncelle.bat', 'Guncelle.bat');
copy('Guncelle.ps1', 'Guncelle.ps1');
copy('README.md', 'README.md');
copy('extension', 'extension');
for (const f of ['server.js', 'web.js', 'sniff.js', 'mp4fix.js', 'setup.js', 'data.js', 'friendly.js', 'web']) copy(path.join('helper', f), path.join('helper', f));

// Yerleşik Node (resmi node.exe): arkadaşların ayrıca Node.js kurması gerekmez
fs.copyFileSync(process.execPath, path.join(stage, 'runtime', 'node.exe'));
fs.writeFileSync(path.join(stage, 'runtime', 'NODE-LISANS.txt'),
  `Bu klasördeki node.exe, Node.js'in resmi sürümüdür (${process.version}).\nNode.js MIT lisanslıdır: https://github.com/nodejs/node/blob/main/LICENSE\nİndirme: https://nodejs.org\n`);

// Windows'un tar.exe'si zip üretebilir (Git Bash'teki GNU tar "C:" yolunu anlamaz, o yüzden tam yol)
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-a', '-cf', zip, '-C', dist, 'VideoIndir']);

console.log(`Hazır: ${zip}  (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
