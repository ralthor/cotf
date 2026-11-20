// Renders the PWA icons (public/icons/*.png) from the same shapes as public/favicon.svg:
// a rounded square and a pawn drawn with straight lines only. Run: npm run build:icons
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BG = [0x2f, 0x48, 0x58];
const FG = [0xf2, 0xe8, 0xcf];
// The pawn from favicon.svg (32×32 units): M11 25h10l-1-3h-8z m2-4h6l1-6h-8z m-1-7h8l-2-3h-4z m3-4h2V7h1V6h-1V5h-2v1h-1v1h1z
const PAWN = 'M11 25h10l-1-3h-8zm2-4h6l1-6h-8zm-1-7h8l-2-3h-4zm3-4h2V7h1V6h-1V5h-2v1h-1v1h1z';

/** Polygons from a path with M/m, h/H, v/V, l/L and z only. */
function polygons(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  const polys = [];
  let poly = null;
  let x = 0;
  let y = 0;
  let start = [0, 0];
  for (let i = 0; i < tokens.length; ) {
    const c = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (c === 'M' || c === 'm') {
      const a = n();
      const b = n();
      [x, y] = c === 'm' ? [x + a, y + b] : [a, b];
      start = [x, y];
      poly = [[x, y]];
      polys.push(poly);
    } else if (c === 'h') poly.push([(x += n()), y]);
    else if (c === 'H') poly.push([(x = n()), y]);
    else if (c === 'v') poly.push([x, (y += n())]);
    else if (c === 'V') poly.push([x, (y = n())]);
    else if (c === 'l') poly.push([(x += n()), (y += n())]);
    else if (c === 'L') poly.push([(x = n()), (y = n())]);
    else if (c === 'z' || c === 'Z') [x, y] = start;
    else throw new Error(`Unsupported path command ${c}`);
  }
  return polys;
}

function inside(polys, px, py) {
  let odd = false;
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** RGBA pixels: background (rounded unless full-bleed), pawn scaled by `scale` around the centre. */
function render(size, { radius, scale }) {
  const pawn = polygons(PAWN);
  const ss = 4; // 4×4 supersampling
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = ((x + (sx + 0.5) / ss) / size) * 32;
          const uy = ((y + (sy + 0.5) / ss) / size) * 32;
          if (!(radius ? inRoundRect(ux, uy, radius) : true)) continue;
          bg++;
          // Undo the pawn's scale around the centre (16, 16).
          if (inside(pawn, 16 + (ux - 16) / scale, 16 + (uy - 16) / scale)) fg++;
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      const f = bg ? fg / bg : 0;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      px[o + 3] = Math.round((bg / n) * 255);
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = join(root, 'public/icons');
const jobs = [
  ['icon-192.png', 192, { radius: 6, scale: 1 }],
  ['icon-512.png', 512, { radius: 6, scale: 1 }],
  // Maskable: full bleed, pawn inside the central safe zone.
  ['maskable-512.png', 512, { radius: 0, scale: 0.7 }],
  // iOS rounds the corners itself.
  ['apple-touch-icon.png', 180, { radius: 0, scale: 0.85 }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(join(out, name), png(size, render(size, opts)));
  console.log(`icons/${name} ${size}×${size}`);
}
