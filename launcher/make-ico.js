// Eklentinin PNG simgelerinden VideoIndir.ico üretir (PNG sıkıştırmalı ICO; Windows Vista ve üzeri okur).
const fs = require('fs');
const path = require('path');

const ext = path.join(__dirname, '..', 'extension');
const sizes = [16, 48, 128];
const pngs = sizes.map((s) => fs.readFileSync(path.join(ext, `icon${s}.png`)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);

let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});

fs.writeFileSync(path.join(__dirname, 'VideoIndir.ico'), Buffer.concat([header, ...entries, ...pngs]));
console.log('VideoIndir.ico hazır');
