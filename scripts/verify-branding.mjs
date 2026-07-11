import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE_LOGO = 'branding/logo-luz-en-ruinas.png';
const PUBLIC_LOGO = 'public/branding/logo-luz-en-ruinas.png';
const EXPECTED_PNGS = [
  [SOURCE_LOGO, 1448, 1086],
  [PUBLIC_LOGO, 1448, 1086],
  ['public/icons/icon-1024.png', 1024, 1024],
  ['public/icons/icon-512.png', 512, 512],
  ['public/icons/icon-192.png', 192, 192],
  ['public/icons/apple-touch-icon.png', 180, 180],
  ['public/icons/favicon-32.png', 32, 32],
  ['public/icons/favicon-16.png', 16, 16]
];

const failures = [];

for (const [file, width, height] of EXPECTED_PNGS) {
  if (!existsSync(file)) {
    failures.push(`falta ${file}`);
    continue;
  }

  if (statSync(file).size === 0) {
    failures.push(`${file} está vacío`);
    continue;
  }

  const metadata = await sharp(file).metadata();
  if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) {
    failures.push(`${file} tiene metadata inesperada: ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
}

const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
const manifestIconPaths = new Set(manifest.icons.map((icon) => icon.src));
for (const [, width, height] of EXPECTED_PNGS.slice(2)) {
  const expected = width === 180 && height === 180 ? '/icons/apple-touch-icon.png' : null;
  if (expected && !existsSync(`public${expected}`)) {
    failures.push(`falta ${expected}`);
  }
}

for (const expected of ['/icons/favicon-16.png', '/icons/favicon-32.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-1024.png']) {
  if (!manifestIconPaths.has(expected)) {
    failures.push(`manifest no referencia ${expected}`);
  }
}

const html = await readFile('public/index.html', 'utf8');
for (const expected of [
  '/branding/logo-luz-en-ruinas.png',
  '/icons/favicon-32.png',
  '/icons/favicon-16.png',
  '/icons/apple-touch-icon.png'
]) {
  if (!html.includes(expected)) {
    failures.push(`index.html no referencia ${expected}`);
  }
}

const sw = await readFile('public/sw.js', 'utf8');
for (const expected of ['/branding/logo-luz-en-ruinas.png', '/icons/icon-1024.png', '/icons/favicon-32.png', '/icons/favicon-16.png']) {
  if (!sw.includes(expected)) {
    failures.push(`sw.js no cachea ${expected}`);
  }
}

if (existsSync('public/icons/icon.svg') || existsSync('public/icons/favicon.svg')) {
  failures.push('quedan iconos SVG anteriores en public/icons');
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('branding ok');
