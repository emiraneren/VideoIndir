// İndirme bitince dosyanın gerçekten MP4 olduğundan emin olur.
// HLS akışlarında yt-dlp'nin TS→MP4 çevirmesi (ses geç başlayan kayıtlar gibi) başarısız olursa dosya
// ".mp4" adıyla ama MPEG-TS biçiminde kalır; bu bazı oynatıcılarda bozuk görüntüye yol açar. Burada onarılır.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(exe, args) {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve({ code: -1, out }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

// {fixed:true} onarıldı · {fixed:false} zaten MP4 (ya da onarılamadı; dosyaya dokunulmaz)
async function ensureMp4(file, binDir) {
  if (!/\.mp4$/i.test(file) || !fs.existsSync(file)) return { fixed: false };
  const probe = await run(path.join(binDir, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=format_name', '-of', 'csv=p=0', file]);
  if (!/mpegts/.test(probe.out)) return { fixed: false };

  const tmp = file.replace(/\.mp4$/i, '') + '.fixing.mp4';
  // Ses sonradan başlıyorsa varsayılan 5 sn'lik analiz yetmez; uzun analiz süresi şart
  const r = await run(path.join(binDir, 'ffmpeg.exe'), [
    '-v', 'error', '-y', '-analyzeduration', '200M', '-probesize', '200M', '-i', file,
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', tmp,
  ]);
  if (r.code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    fs.rmSync(tmp, { force: true });
    return { fixed: false, failed: true };
  }
  fs.renameSync(tmp, file);
  return { fixed: true };
}

module.exports = { ensureMp4 };
