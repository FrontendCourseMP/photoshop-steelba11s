export type DecodedImage = {
  signature: number;
  version: number;
  flag: number;
  width: number;
  height: number;
  reserve: number;
  colorDepth: number;
  hasMask: boolean;
  data: Uint8ClampedArray;
};

export function decodeGB7(buffer: ArrayBuffer): DecodedImage {
  if (buffer.byteLength < 12) {
    throw new Error("Файл слишком маленький для GB7");
  }

  const view = new DataView(buffer);
  const signature = view.getUint32(0, false);
  const version = view.getUint8(4);
  const flag = view.getUint8(5);
  const width = view.getUint16(6, false);
  const height = view.getUint16(8, false);
  const reserve = view.getUint16(10, false);

  if (signature !== 0x4742371d) {
    throw new Error("Некорректная сигнатура GB7");
  }

  if (version !== 1) {
    throw new Error("Неподдерживаемая версия GB7");
  }

  if ((flag & 0b11111110) !== 0) {
    throw new Error("Некорректные зарезервированные биты флага");
  }

  if (reserve !== 0) {
    throw new Error("Некорректное значение reserve");
  }

  if (buffer.byteLength !== 12 + width * height) {
    throw new Error("Размер файла не совпадает с width * height");
  }

  const pixels = new Uint8ClampedArray(buffer, 12);
  const hasMask = (flag & 1) === 1;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < pixels.length; i += 1) {
    const byte = pixels[i];
    const gray7 = byte & 0b01111111;
    const gray8 = Math.round((gray7 / 127) * 255);
    const maskBit = (byte & 0b10000000) >> 7;
    const alpha = hasMask ? (maskBit ? 255 : 0) : 255;
    const offset = i * 4;

    rgba[offset] = gray8;
    rgba[offset + 1] = gray8;
    rgba[offset + 2] = gray8;
    rgba[offset + 3] = alpha;
  }

  return {
    signature,
    version,
    flag,
    width,
    height,
    reserve,
    colorDepth: hasMask ? 8 : 7,
    hasMask,
    data: rgba,
  };
}
