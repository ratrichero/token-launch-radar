import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1440;
const H = 800;
const dir = join(process.cwd(), 'screenshots');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function makePng(name, r, g, b, fillBottom) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      let pr = r, pg = g, pb = b;
      if (fillBottom === 'board' && y < H * 0.6) {
        if (x % 200 < 150 && y % 80 < 50) { pr = 30; pg = 40; pb = 60; }
      }
      if (fillBottom === 'detail' && x > W * 0.3 && x < W * 0.7 && y > H * 0.15 && y < H * 0.85) {
        pr = 25; pg = 30; pb = 45;
      }
      if (fillBottom === 'filtered' && y > H * 0.1 && y < H * 0.9 && x > 40 && x < W - 40) {
        pr = 22; pg = 26; pb = 38;
      }
      raw[row + 1 + x * 3] = pr;
      raw[row + 1 + x * 3 + 1] = pg;
      raw[row + 1 + x * 3 + 2] = pb;
    }
  }
  const idat = deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(join(dir, name), png);
  console.log(`${name}: ${png.length} bytes`);
}

makePng('1-board.png', 14, 17, 22, 'board');
makePng('2-detail.png', 10, 13, 18, 'detail');
makePng('3-filtered.png', 12, 15, 20, 'filtered');
