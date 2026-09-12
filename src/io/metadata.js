import { validateSize } from '../domain/raster.js';

export function inspectFormat(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if ([0x47, 0x42, 0x37, 0x1d].every((v, i) => bytes[i] === v)) return { format: 'GB7' };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('Повреждён заголовок PNG.');
    const width = view.getUint32(16), height = view.getUint32(20);
    validateSize(width, height);
    const bits = bytes[24], type = bytes[25];
    const allowed = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
    if (!allowed[type]?.includes(bits)) throw new Error('Неподдерживаемая структура PNG.');
    let transparency = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), chunk = view.getUint32(offset + 4);
      if (offset + length + 12 > bytes.length) throw new Error('Обрезан блок PNG.');
      if (chunk === 0x74524e53) transparency = true;
      offset += length + 12;
      if (chunk === 0x49454e44) break;
    }
    const gray = type === 0 || type === 4;
    const alpha = type === 4 || type === 6 || transparency;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    const description = type === 3 ? 'индексированный' : (gray ? 'Gray' : 'RGB') + (type === 4 || type === 6 ? ' + Alpha' : '');
    return { format: 'PNG', width, height, model: (gray ? 'G' : 'RGB') + (alpha ? 'A' : ''), depth: `${bits * channels} бит (${description})${transparency ? ' + tRNS' : ''}` };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error('Повреждена структура JPEG.');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error('Обрезан блок JPEG.');
      if (frames.has(marker)) {
        if (length < 8) throw new Error('Повреждён заголовок JPEG.');
        const bits = bytes[offset + 2], height = view.getUint16(offset + 3), width = view.getUint16(offset + 5), channels = bytes[offset + 7];
        validateSize(width, height);
        if (![1, 3, 4].includes(channels)) throw new Error('Неподдерживаемое число компонентов JPEG.');
        return { format: 'JPG', width, height, model: channels === 1 ? 'G' : 'RGB', depth: `${bits * channels} бит (${channels === 1 ? 'Gray' : channels === 4 ? 'CMYK → RGB' : 'RGB'})` };
      }
      offset += length;
    }
    throw new Error('Не найдены размеры JPEG.');
  }
  throw new Error('Поддерживаются только PNG, JPG и GB7. Формат определяется по содержимому файла.');
}
