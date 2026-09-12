import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(size) {
  const row = size * 4 + 1, raw = Buffer.alloc(row * size);
  const r = size * 0.22, bar = [0.42, 0.24, 0.56, 0.76], dot = [0.62, 0.64, 0.76, 0.76];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r)), cy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r));
    const inside = Math.hypot(cx, cy) <= r;
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    const mark = (u >= bar[0] && u <= bar[2] && v >= bar[1] && v <= bar[3]) || (u >= dot[0] && u <= dot[2] && v >= dot[1] && v <= dot[3]);
    const o = y * row + 1 + x * 4;
    if (!inside) { raw[o + 3] = 0; continue; }
    const [R, G, B] = mark ? [0xfd, 0xfa, 0xf4] : [0x9a, 0x4a, 0x24];
    raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 48, 128]) writeFileSync(new URL(`./${s}.png`, import.meta.url), png(s));
console.log('icons written');
