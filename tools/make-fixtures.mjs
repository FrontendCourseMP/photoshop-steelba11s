import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../samples/', import.meta.url));
await mkdir(directory, { recursive: true });

// Minimal PNG writer for controlled test inputs, independent of browser export.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
function png(width, height, colorType, pixel) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = colorType;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * channels + 1) + 1 + x * channels);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const rgb = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [128, 64, 32]];
const fixtures = {
  'rgb.png': png(3, 2, 2, (x, y) => rgb[y * 3 + x]),
  'rgba.png': png(3, 2, 6, (x, y) => [...rgb[y * 3 + x], [255, 255, 255, 128, 0, 64][y * 3 + x]]),
  'rgba-opaque.png': png(3, 2, 6, (x, y) => [...rgb[y * 3 + x], 255]),
  'gray.png': png(3, 2, 0, (x, y) => [[0, 64, 128, 192, 224, 255][y * 3 + x]]),
  'gray-alpha.png': png(3, 2, 4, (x, y) => [128, [0, 64, 128, 192, 224, 255][y * 3 + x]]),
  'rgb-gray-content.png': png(3, 2, 2, () => [128, 128, 128]),
  'transparent.png': png(64, 64, 6, () => [100, 200, 0, 0]),
  'large-rgb.png': png(3200, 2400, 2, (x, y) => [x % 256, y % 256, (x + y) % 256]),
  'gray.gb7': Buffer.from([71, 66, 55, 29, 1, 0, 0, 3, 0, 2, 0, 0, 0, 32, 64, 96, 112, 127]),
  'mask.gb7': Buffer.from([71, 66, 55, 29, 1, 1, 0, 3, 0, 2, 0, 0, 0, 160, 64, 224, 112, 255]),
};
const largeGray = Buffer.alloc(12 + 3200 * 2400);
largeGray.set([71, 66, 55, 29, 1, 0, 12, 128, 9, 96, 0, 0]);
for (let i = 12; i < largeGray.length; i++) largeGray[i] = (i - 12) % 128;
fixtures['large-gray.gb7'] = largeGray;
for (const [name, bytes] of Object.entries(fixtures)) await writeFile(`${directory}/${name}`, bytes);
console.log(`Generated ${Object.keys(fixtures).length} test images in samples/`);
