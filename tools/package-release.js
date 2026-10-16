// Arkadaşlara verilecek sürüm paketini üretir: dist\VideoIndir-v<sürüm>.zip
// Üst klasörde yalnızca: VideoIndir.exe, BENIOKU.txt, Kur.bat, Kaldir.bat. Gerisi dosyalar\ altında (yerleşik Node, servis kodu, eklenti, güncelleyici).
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
// Düzen: üst klasörde yalnızca kullanıcının dokunacağı 4 dosya; geri kalan her şey "dosyalar" altında
const app = path.join(stage, 'dosyalar');
fs.mkdirSync(path.join(app, 'helper'), { recursive: true });
fs.mkdirSync(path.join(app, 'runtime'), { recursive: true });

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(stage, to), { recursive: true });
const into = (from, to) => copy(from, path.join('dosyalar', to));
copy('VideoIndir.exe', 'VideoIndir.exe');
for (const f of ['BENIOKU.txt', 'Kur.bat', 'Kaldir.bat']) copy(path.join('paket', f), f);
for (const f of ['BENIOKU.txt', 'Kur.bat', 'Kaldir.bat']) { // Not Defteri / cmd için CRLF
  const fp = path.join(stage, f);
  fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(/\r?\n/g, '\r\n'));
}
for (const f of ['Kur.ps1', 'Kaldir.ps1']) into(path.join('paket', f), f);
// WebView2 DLL'leri ve lisansı; güncelleyici
for (const f of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) into(f, f);
into(path.join('launcher', 'lib', 'WEBVIEW2-LICENSE.txt'), 'WEBVIEW2-LICENSE.txt');
into('Guncelle.bat', 'Guncelle.bat');
into('Guncelle.ps1', 'Guncelle.ps1');
into('extension', 'extension');
for (const f of ['server.js', 'web.js', 'sniff.js', 'mp4fix.js', 'setup.js', 'data.js', 'friendly.js', 'updater.js', 'web']) into(path.join('helper', f), path.join('helper', f));

// Yerleşik Node (resmi node.exe): arkadaşların ayrıca Node.js kurması gerekmez
fs.copyFileSync(process.execPath, path.join(app, 'runtime', 'node.exe'));
fs.writeFileSync(path.join(app, 'runtime', 'NODE-LISANS.txt'),
  `Bu klasördeki node.exe, Node.js'in resmi sürümüdür (${process.version}).\nNode.js MIT lisanslıdır: https://github.com/nodejs/node/blob/main/LICENSE\nİndirme: https://nodejs.org\n`);

// Windows'un tar.exe'si zip üretebilir (Git Bash'teki GNU tar "C:" yolunu anlamaz, o yüzden tam yol)
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-a', '-cf', zip, '-C', dist, 'VideoIndir']);

console.log(`Hazır: ${zip}  (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
