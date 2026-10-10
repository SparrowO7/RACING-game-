// Generates the app icon with no image dependencies — PNG is written by hand (zlib is a
// Node built-in) and wrapped in an ICO container, which has accepted embedded PNGs since
// Vista. electron-builder needs a 256x256 .ico for the Windows target, and the project
// only had an SVG, so `npm run build` was failing before this existed.
//
// The mark is three forward-leaning bars in the game's own palette (cyan / magenta /
// amber on the HUD's ink background) — it stays legible down to 16px, where a detailed
// car silhouette would turn to mud.
//
// Run: node tools/make-icon.cjs

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [256, 128, 64, 48, 32, 16];
const BG = [0x08, 0x0b, 0x16];
const BARS = [
  { x: 0.17, color: [0x22, 0xe3, 0xff] }, // neon cyan
  { x: 0.40, color: [0xff, 0x2d, 0x95] }, // neon magenta
  { x: 0.63, color: [0xff, 0xd2, 0x3f] }, // neon amber
];
const BAR_W = 0.145;
const SLANT = 0.42;
const TOP = 0.20, BOT = 0.80;

// Coverage of one bar at normalised (u, v), supersampled by the caller.
function barCoverage(bar, u, v) {
  if (v < TOP || v > BOT) return 0;
  const shifted = u + SLANT * (v - 0.5);
  return shifted >= bar.x && shifted <= bar.x + BAR_W ? 1 : 0;
}

function renderRGBA(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling for clean edges at small sizes
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          let c = BG;
          for (const bar of BARS) {
            if (barCoverage(bar, u, v)) { c = bar.color; break; }
          }
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      px[o] = Math.round(acc[0] / n);
      px[o + 1] = Math.round(acc[1] / n);
      px[o + 2] = Math.round(acc[2] / n);
      px[o + 3] = 255;
    }
  }
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // one filter byte (0 = none) per scanline
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(images.length, 4);  // image count

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir[o] = img.size >= 256 ? 0 : img.size;      // 0 means 256
    dir[o + 1] = img.size >= 256 ? 0 : img.size;
    dir[o + 2] = 0;                                // palette colours
    dir[o + 3] = 0;                                // reserved
    dir.writeUInt16LE(1, o + 4);                   // colour planes
    dir.writeUInt16LE(32, o + 6);                  // bits per pixel
    dir.writeUInt32BE(0, o + 8);
    dir.writeUInt32LE(img.png.length, o + 8);      // byte size
    dir.writeUInt32LE(offset, o + 12);             // byte offset
    offset += img.png.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

const images = SIZES.map((size) => ({ size, png: encodePNG(size, renderRGBA(size)) }));
fs.writeFileSync(path.join(assets, 'icon.ico'), encodeICO(images));
fs.writeFileSync(path.join(assets, 'icon.png'), images[0].png); // 256px, for Linux/dev

console.log('wrote assets/icon.ico (' + SIZES.join(', ') + ') and assets/icon.png');
