import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const ICONS = [
  { size: 1024, file: 'public/icons/icon-1024.png' },
  { size: 512, file: 'public/icons/icon-512.png' },
  { size: 192, file: 'public/icons/icon-192.png' },
  { size: 180, file: 'public/icons/apple-touch-icon.png' },
  { size: 32, file: 'public/icons/favicon-32.png' },
  { size: 16, file: 'public/icons/favicon-16.png' }
];

const SOURCE_LOGO = 'branding/logo-luz-en-ruinas.png';
const PUBLIC_LOGO = 'public/branding/logo-luz-en-ruinas.png';
const BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 };
const SAFE_AREA_RATIO = 0.72;

const sourceMetadata = await sharp(SOURCE_LOGO).metadata();

if (sourceMetadata.format !== 'png' || sourceMetadata.width !== 1448 || sourceMetadata.height !== 1086) {
  throw new Error(`Unexpected source logo metadata: ${JSON.stringify(sourceMetadata)}`);
}

mkdirSync(dirname(resolve(PUBLIC_LOGO)), { recursive: true });
copyFileSync(SOURCE_LOGO, PUBLIC_LOGO);
console.log(`copied ${PUBLIC_LOGO}`);

for (const icon of ICONS) {
  const file = resolve(icon.file);
  mkdirSync(dirname(file), { recursive: true });

  const maxContentSize = Math.round(icon.size * SAFE_AREA_RATIO);
  const logoBuffer = await sharp(SOURCE_LOGO)
    .resize({
      width: maxContentSize,
      height: maxContentSize,
      fit: 'inside',
      withoutEnlargement: false
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: icon.size,
      height: icon.size,
      channels: 3,
      background: BACKGROUND
    }
  })
    .composite([
      {
        input: logoBuffer,
        gravity: 'center'
      }
    ])
    .png({
      compressionLevel: 9,
      palette: false
    })
    .toFile(file);

  const metadata = await sharp(file).metadata();
  if (metadata.format !== 'png' || metadata.width !== icon.size || metadata.height !== icon.size) {
    throw new Error(`Invalid generated icon: ${icon.file}`);
  }

  console.log(`generated ${icon.file}`);
}
