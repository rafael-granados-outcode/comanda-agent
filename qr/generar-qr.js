// Genera los QR de las mesas con el logo de DON en el centro.
// Cada QR abre la carta con ?mesa=N; la tienda guarda ese número como
// atributo "Mesa" del carrito y llega a la comanda.
//
//   npm run qr                         -> mesas 1..40
//   npm run qr -- --desde 1 --hasta 35
//   npm run qr -- --mesas 1,2,5,VIP
//   QR_URL=https://tudominio.com/collections/menu-comidas npm run qr
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';

const dir = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, [])
);

const BASE = args.url || process.env.QR_URL || 'https://doninvita.shop/pages/restaurante';
const OUT = path.resolve(args.out || path.join(dir, 'salida'));
const LOGO = path.resolve(args.logo || path.join(dir, 'logo-qr.webp'));
const SIZE = 1200;        // px del QR (sin la etiqueta)
const BADGE = 0.24;       // diámetro del círculo del logo, fracción del QR
const LABEL_H = 220;      // alto de la franja "MESA N"

const mesas = args.mesas
  ? args.mesas.split(',').map((s) => s.trim()).filter(Boolean)
  : range(Number(args.desde || 1), Number(args.hasta || 40));

function range(a, b) {
  const r = [];
  for (let i = a; i <= b; i++) r.push(String(i));
  return r;
}

function urlFor(mesa) {
  const u = new URL(BASE);
  u.searchParams.set('mesa', mesa);
  return u.toString();
}

// Logo blanco sobre círculo negro con aro blanco, para que se lea sobre el QR.
async function badge() {
  const d = Math.round(SIZE * BADGE);
  const ring = Math.round(d * 0.06);
  const inner = d - ring * 2;
  const logo = await sharp(LOGO).trim().resize({
    width: Math.round(inner * 0.72),
    height: Math.round(inner * 0.72),
    fit: 'inside',
  }).png().toBuffer();

  const circle = Buffer.from(
    `<svg width="${d}" height="${d}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/>
       <circle cx="${d / 2}" cy="${d / 2}" r="${inner / 2}" fill="#000"/>
     </svg>`
  );
  return sharp(circle).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
}

function label(mesa) {
  return Buffer.from(
    `<svg width="${SIZE}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
       <rect width="100%" height="100%" fill="#fff"/>
       <text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle"
             font-family="Barlow Condensed, Arial Narrow, Arial, sans-serif"
             font-weight="700" font-size="130" letter-spacing="6" fill="#000">MESA ${escape(mesa)}</text>
       <text x="50%" y="88%" text-anchor="middle"
             font-family="Arial, sans-serif" font-size="34" fill="#555">Escanea para pedir</text>
     </svg>`
  );
}

function escape(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const logo = await badge();

  for (const mesa of mesas) {
    const url = urlFor(mesa);
    // Corrección H: tolera ~30% de módulos tapados, el logo ocupa bastante menos.
    const qr = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'H',
      margin: 4,
      width: SIZE,
      color: { dark: '#000000', light: '#ffffff' },
    });

    const withLogo = await sharp(qr).composite([{ input: logo, gravity: 'center' }]).png().toBuffer();
    const file = path.join(OUT, `mesa-${mesa}.png`);
    await sharp({ create: { width: SIZE, height: SIZE + LABEL_H, channels: 3, background: '#fff' } })
      .composite([
        { input: withLogo, top: 0, left: 0 },
        { input: label(mesa), top: SIZE, left: 0 },
      ])
      .png()
      .toFile(file);
    console.log(`Mesa ${mesa} -> ${url}`);
  }
  console.log(`\n${mesas.length} QR en ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
