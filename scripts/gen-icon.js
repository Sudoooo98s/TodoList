// 生成应用图标与托盘图标（纯 Node 实现，无需额外依赖）
// 输出: assets/icon.png (1024x1024), assets/tray.png (32x32)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

// 画 1024x1024：圆角矩形渐变底 + 白色对勾
function drawIcon(size) {
  const S = size;
  const px = Buffer.alloc(S * S * 4);
  const half = S / 2;
  const scale = S / 256;
  const radius = 56 * scale;
  // 对勾折线两端点（256 坐标系，按尺寸等比缩放）
  const pts = [[62, 133], [109, 180], [197, 92]].map(([x, y]) => [x * scale, y * scale]);
  const halfW = 9.5 * scale;

  function sdRoundRect(x, y) {
    const qx = Math.abs(x - half) - (half - radius);
    const qy = Math.abs(y - half) - (half - radius);
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
  }

  function distToSeg(x, y, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = x - a[0], wy = y - a[1];
    const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(x - (a[0] + t * vx), y - (a[1] + t * vy));
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      // 背景（垂直渐变）
      const t = y / S;
      let r = lerp(99, 124, t), g = lerp(102, 58, t), b = lerp(241, 237, t);
      const bgA = clamp(0.5 - sdRoundRect(x + 0.5, y + 0.5), 0, 1);
      // 对勾
      const d1 = distToSeg(x + 0.5, y + 0.5, pts[0], pts[1]);
      const d2 = distToSeg(x + 0.5, y + 0.5, pts[1], pts[2]);
      const d = Math.min(d1, d2);
      const checkA = clamp(halfW + 0.5 - d, 0, 1);
      const a = bgA * (1 - checkA) + checkA;
      px[i] = checkA > 0 ? lerp(r, 255, checkA) : r;
      px[i + 1] = checkA > 0 ? lerp(g, 255, checkA) : g;
      px[i + 2] = checkA > 0 ? lerp(b, 255, checkA) : b;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function downsample(src, srcSize, dstSize) {
  const step = srcSize / dstSize;
  const out = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < step; dy++) {
        for (let dx = 0; dx < step; dx++) {
          const i = ((y * step + dy) * srcSize + (x * step + dx)) * 4;
          const al = src[i + 3] / 255;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al;
          a += src[i + 3];
        }
      }
      const o = (y * dstSize + x) * 4;
      const al = a / (step * step * 255);
      out[o] = al > 0 ? Math.round(r / (a / 255)) : 0;
      out[o + 1] = al > 0 ? Math.round(g / (a / 255)) : 0;
      out[o + 2] = al > 0 ? Math.round(b / (a / 255)) : 0;
      out[o + 3] = Math.round(a / (step * step));
    }
  }
  return out;
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const icon = drawIcon(1024);
fs.writeFileSync(path.join(outDir, 'icon.png'), png(1024, 1024, icon));
fs.writeFileSync(path.join(outDir, 'tray.png'), png(32, 32, downsample(icon, 1024, 32)));
console.log('icons generated:', outDir);
