// Yama paketi: iki sürüm arasında değişen helper\ ve extension\ dosyalarını küçük bir zip'e koyar.
// Kullanım: node tools\package-patch.js <eski-commit-veya-etiket> <yeni-sürüm> [--exe]
// Kullanıcı zip'i kurulu VideoIndir klasörüne çıkarıp "dosyaları değiştir" der; tam paketi yeniden indirmesi gerekmez.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const withExe = process.argv.includes('--exe'); // exe de değiştiyse yamaya ekle
const [from, version] = process.argv.slice(2).filter((a) => a !== '--exe');
if (!from || !version) { console.error('Kullanım: node tools\\package-patch.js <eski-commit> <yeni-sürüm>'); process.exit(1); }

const root = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
// Yalnızca pakete giren klasörlerdeki değişen dosyalar (silinenler hariç)
const files = git('diff', '--name-only', '--diff-filter=AM', from, 'HEAD', '--', 'helper', 'extension').split('\n').filter(Boolean);
if (!files.length) { console.error('Değişen dosya yok.'); process.exit(1); }

const dist = path.join(root, 'dist');
const stage = path.join(dist, 'patch');
const zip = path.join(dist, `VideoIndir-yama-v${version}.zip`);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true });
  fs.copyFileSync(path.join(root, f), path.join(stage, f));
}

if (withExe) { fs.copyFileSync(path.join(root, 'VideoIndir.exe'), path.join(stage, 'VideoIndir.exe')); files.push('VideoIndir.exe'); }

// Üst klasörsüz zip: kurulu klasöre çıkarılınca dosyalar yerlerine oturur (helper\..., extension\...)
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-a', '-cf', zip, '-C', stage, ...fs.readdirSync(stage)]);

console.log(`Yama hazır: ${zip}  (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
files.forEach((f) => console.log('  ' + f));
