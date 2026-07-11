import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ICONS = [
  { size: 180, file: 'public/icons/apple-touch-icon.png' },
  { size: 192, file: 'public/icons/icon-192.png' },
  { size: 512, file: 'public/icons/icon-512.png' }
];

for (const icon of ICONS) {
  const png = renderIcon(icon.size);
  const file = resolve(icon.file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`generated ${icon.file}`);
}

function renderIcon(size) {
  const image = new Uint8Array(size * size * 4);
  fillRect(image, size, 0, 0, size, size, [24, 22, 19, 255]);

  fillEllipse(image, size, size * 0.5, size * 0.52, size * 0.31, size * 0.34, [247, 240, 229, 255]);
  fillRect(image, size, size * 0.18, size * 0.52, size * 0.64, size * 0.24, [247, 240, 229, 255]);
  fillRoundedRect(image, size, size * 0.22, size * 0.48, size * 0.56, size * 0.26, size * 0.08, [213, 166, 66, 255]);
  fillEllipse(image, size, size * 0.5, size * 0.36, size * 0.21, size * 0.13, [247, 240, 229, 255]);
  fillEllipse(image, size, size * 0.5, size * 0.39, size * 0.16, size * 0.1, [24, 22, 19, 255]);

  const dark = [24, 22, 19, 255];
  fillRect(image, size, size * 0.38, size * 0.53, size * 0.08, size * 0.19, dark);
  fillRoundedRect(image, size, size * 0.43, size * 0.53, size * 0.19, size * 0.09, size * 0.035, dark);
  fillRoundedRect(image, size, size * 0.43, size * 0.63, size * 0.21, size * 0.09, size * 0.035, dark);
  fillRoundedRect(image, size, size * 0.49, size * 0.56, size * 0.08, size * 0.03, size * 0.015, [213, 166, 66, 255]);
  fillRoundedRect(image, size, size * 0.49, size * 0.66, size * 0.09, size * 0.03, size * 0.015, [213, 166, 66, 255]);

  return encodePng(image, size, size);
}

function fillRect(image, size, x, y, width, height, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(size, Math.ceil(x + width));
  const bottom = Math.min(size, Math.ceil(y + height));

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      setPixel(image, size, px, py, color);
    }
  }
}

function fillRoundedRect(image, size, x, y, width, height, radius, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(size, Math.ceil(x + width));
  const bottom = Math.min(size, Math.ceil(y + height));
  const r = Math.max(0, radius);

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const cx = px < x + r ? x + r : px > x + width - r ? x + width - r : px;
      const cy = py < y + r ? y + r : py > y + height - r ? y + height - r : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r * r || (px >= x + r && px <= x + width - r) || (py >= y + r && py <= y + height - r)) {
        setPixel(image, size, px, py, color);
      }
    }
  }
}

function fillEllipse(image, size, cx, cy, rx, ry, color) {
  const left = Math.max(0, Math.floor(cx - rx));
  const top = Math.max(0, Math.floor(cy - ry));
  const right = Math.min(size, Math.ceil(cx + rx));
  const bottom = Math.min(size, Math.ceil(cy + ry));

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      const nx = (px - cx) / rx;
      const ny = (py - cy) / ry;
      if (nx * nx + ny * ny <= 1) {
        setPixel(image, size, px, py, color);
      }
    }
  }
}

function setPixel(image, size, x, y, [r, g, b, a]) {
  const index = (y * size + x) * 4;
  image[index] = r;
  image[index + 1] = g;
  image[index + 2] = b;
  image[index + 3] = a;
}

function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
