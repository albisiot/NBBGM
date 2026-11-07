// pnpm icons: disegna le icone della PWA (stile Edicola: palla rossa con le cuciture d'inchiostro su carta rosa) in PNG, senza dipendenze: ogni pixel
// si calcola dalla geometria, con 4x4 campioni per l'antialiasing, e il PNG si scrive con zlib di Node.
// Scrive in apps/web/public/icons: icon-192.png, icon-512.png, maskable-512.png (Android ritaglia un cerchio o un
// quadrato arrotondato: la palla sta nell'80% centrale), apple-touch-icon.png (180, iPhone) e badge-96.png,
// l'icona delle notifiche nella barra di stato di Android: Android ne usa solo la trasparenza e la disegna in
// bianco, quindi un'icona opaca diventa un quadrato bianco. Il badge è la palla bianca su fondo trasparente, con
// le cuciture vuote (più larghe, perché si vede a 24 dp).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ROOT } from './paths.ts';

type Rgb = [number, number, number];
const BACKGROUND: Rgb = [244, 220, 211]; // stampa-50, carta rosa
const BALL: Rgb = [179, 18, 42]; // rosso-600
const BALL_LIGHT: Rgb = [194, 39, 63]; // rosso-500
const SEAM: Rgb = [27, 23, 22]; // stampa-900, inchiostro

/** Dove cade il punto (x, y), in coordinate da -1 a 1: fuori dalla palla di raggio r, su una cucitura (spessa w) o sulla palla. */
function region(x: number, y: number, r: number, w: number): 'out' | 'seam' | 'ball' {
  const d = Math.hypot(x, y);
  if (d > r) return 'out';
  const seam =
    Math.abs(x) < w ||
    Math.abs(y) < w ||
    // Le due curve laterali: archi di cerchi centrati fuori dalla palla
    Math.abs(Math.hypot(x - r * 1.55, y) - r * 1.12) < w ||
    Math.abs(Math.hypot(x + r * 1.55, y) - r * 1.12) < w ||
    d > r - w * 1.1;
  return seam ? 'seam' : 'ball';
}

/** Colore del punto (x, y) in coordinate da -1 a 1, con la palla di raggio r. */
function shade(x: number, y: number, r: number): Rgb {
  const where = region(x, y, r, r * 0.045);
  if (where === 'out') return BACKGROUND;
  if (where === 'seam') return SEAM;
  // Luce dall'alto a sinistra
  const t = Math.max(0, Math.min(1, 0.5 - (x + y) / (2.6 * r)));
  return BALL.map((c, i) => Math.round(c + (BALL_LIGHT[i]! - c) * t)) as Rgb;
}

function render(size: number, ballRadius: number): Buffer {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filtro PNG: nessuno
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / S) / size) * 2 - 1;
          const c = shade(x, y, ballRadius);
          for (let i = 0; i < 3; i++) acc[i]! += c[i]!;
        }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i]! / (S * S));
    }
  }
  return png(size, size, raw);
}

/** Badge delle notifiche: bianco, con la trasparenza data dalla palla senza le cuciture (RGBA). */
function renderBadge(size: number, ballRadius: number): Buffer {
  const S = 4;
  const row = size * 4 + 1;
  const raw = Buffer.alloc(size * row);
  for (let py = 0; py < size; py++) {
    raw[py * row] = 0;
    for (let px = 0; px < size; px++) {
      let inside = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / S) / size) * 2 - 1;
          if (region(x, y, ballRadius, ballRadius * 0.08) === 'ball') inside++;
        }
      const o = py * row + 1 + px * 4;
      raw[o] = raw[o + 1] = raw[o + 2] = 255;
      raw[o + 3] = Math.round((255 * inside) / (S * S));
    }
  }
  return png(size, size, raw, true);
}

// ---------------------------------------------------------------- PNG (RGB o RGBA, 8 bit)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width: number, height: number, raw: Buffer, alpha = false): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit per canale
  header[9] = alpha ? 6 : 2; // RGBA o RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(ROOT, 'apps', 'web', 'public', 'icons');
mkdirSync(out, { recursive: true });
const icons: [string, number, number][] = [
  ['icon-192.png', 192, 0.82],
  ['icon-512.png', 512, 0.82],
  // Maskable: la zona sicura è il cerchio di raggio 0,8 (40% del lato)
  ['maskable-512.png', 512, 0.66],
  ['apple-touch-icon.png', 180, 0.78],
];
for (const [name, size, r] of icons) {
  writeFileSync(join(out, name), render(size, r));
  console.log(`${name} (${size}x${size})`);
}
writeFileSync(join(out, 'badge-96.png'), renderBadge(96, 0.94));
console.log('badge-96.png (96x96, bianco su trasparente)');
