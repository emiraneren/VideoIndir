// Aynı eklenti kodundan Firefox sürümünü üretir: extension-firefox\ klasörü ve VideoIndir-firefox.xpi.
// Firefox arka planı service worker yerine "scripts" ile çalıştırır ve eklenti kimliği ister.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'extension');
const out = path.join(root, 'extension-firefox');
const xpi = path.join(root, 'VideoIndir-firefox.xpi');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
manifest.background = { scripts: ['common.js', 'background.js'] };
manifest.browser_specific_settings = {
  gecko: {
    id: 'videoindir@local',
    strict_min_version: '128.0', // content script "world: MAIN" ve scripting API'si için
    data_collection_permissions: { required: ['none'] }, // hiçbir veri geliştiriciye gitmez; her şey yerel
  },
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

// .xpi = zip. Windows 10/11'deki tar.exe (bsdtar) zip üretebilir; Git Bash'teki GNU tar "C:" yolunu anlamaz, o yüzden tam yol.
const zip = xpi.replace(/\.xpi$/, '.zip');
fs.rmSync(zip, { force: true });
fs.rmSync(xpi, { force: true });
const winTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
// "." yerine dosyaları tek tek ver: girdiler "./manifest.json" yerine "manifest.json" olur (Firefox/AMO için doğrusu bu)
execFileSync(fs.existsSync(winTar) ? winTar : 'tar', ['-a', '-cf', zip, '-C', out, ...fs.readdirSync(out)]);
fs.renameSync(zip, xpi);

console.log('Hazır:');
console.log('  Klasör :', out);
console.log('  Paket  :', xpi);
