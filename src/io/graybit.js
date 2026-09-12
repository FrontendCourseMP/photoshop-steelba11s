import { luminance, validateRaster, validateSize, yieldToUI } from '../domain/raster.js';

const SIGNATURE = [0x47, 0x42, 0x37, 0x1d];
const HEADER_SIZE = 12;

export async function decodeGrayBit(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE || !SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('Неверная сигнатура или неполный заголовок GB7.');
  }
  if (bytes[4] !== 1) throw new Error('Поддерживается только версия 1 формата GB7.');
  if ((bytes[5] & 0xfe) || bytes[10] || bytes[11]) throw new Error('Резервные биты и байты GB7 должны быть нулевыми.');
  const view = new DataView(buffer);
  const width = view.getUint16(6, false), height = view.getUint16(8, false);
  validateSize(width, height);
  if (bytes.length !== HEADER_SIZE + width * height) throw new Error('Размер данных GB7 не совпадает с размерами в заголовке.');
  const hasAlpha = Boolean(bytes[5] & 1);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let start = 0; start < width * height; start += 262144) {
    const end = Math.min(start + 262144, width * height);
    for (let p = start; p < end; p++) {
      const value = bytes[HEADER_SIZE + p];
      if (!hasAlpha && (value & 0x80)) throw new Error('В GB7 без маски старший бит пикселя должен быть нулевым.');
      const gray = Math.round((value & 0x7f) * 255 / 127);
      data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = gray;
      data[p * 4 + 3] = hasAlpha ? ((value & 0x80) ? 255 : 0) : 255;
    }
    await yieldToUI();
  }
  return { width, height, data, metadata: { format: 'GB7', model: hasAlpha ? 'GA' : 'G', depth: hasAlpha ? '7 + 1 бит (Gray + маска)' : '7 бит (Gray)' } };
}

export async function encodeGrayBit(raster) {
  validateRaster(raster);
  const { width, height, data } = raster;
  let hasAlpha = false;
  for (let start = 3; start < data.length; start += 1048576) {
    for (let i = start; i < Math.min(start + 1048576, data.length); i += 4) {
      if (data[i] < 255) { hasAlpha = true; break; }
    }
    if (hasAlpha) break;
    await yieldToUI();
  }
  const buffer = new ArrayBuffer(HEADER_SIZE + width * height);
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  bytes.set(SIGNATURE);
  bytes[4] = 1;
  bytes[5] = Number(hasAlpha);
  view.setUint16(6, width, false);
  view.setUint16(8, height, false);
  for (let start = 0; start < width * height; start += 262144) {
    for (let p = start; p < Math.min(start + 262144, width * height); p++) {
      const i = p * 4;
      const gray = Math.round(luminance(data[i], data[i + 1], data[i + 2]) * 127 / 255);
      bytes[HEADER_SIZE + p] = gray | (hasAlpha && data[i + 3] >= 128 ? 0x80 : 0);
    }
    await yieldToUI();
  }
  return buffer;
}
