// cloudflared.exe'yi (Cloudflare'in resmi tünel istemcisi) helper\bin klasörüne indirir.
const fs = require('fs');
const path = require('path');

const BIN = path.join(__dirname, '..', 'helper', 'bin');
const DEST = path.join(BIN, 'cloudflared.exe');
const URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

(async () => {
  if (fs.existsSync(DEST)) return console.log('cloudflared zaten var.');
  fs.mkdirSync(BIN, { recursive: true });
  process.stdout.write('cloudflared indiriliyor (~60 MB)... ');
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tmp = DEST + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, DEST);
  console.log('tamam');
})().catch((e) => { console.error('\nHATA:', e.message); process.exit(1); });
