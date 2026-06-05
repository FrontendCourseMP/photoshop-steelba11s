export type EncodedImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  hasMask: boolean;
};

const MAX_GB7_DIMENSION = 0xffff;

function validateGB7Image(image: EncodedImage): void {
  const width = Math.round(image.width);
  const height = Math.round(image.height);

  if (width !== image.width || height !== image.height || width <= 0 || height <= 0) {
    throw new Error("Размеры GB7 должны быть положительными целыми числами");
  }

  if (width > MAX_GB7_DIMENSION || height > MAX_GB7_DIMENSION) {
    throw new Error("GB7 поддерживает ширину и высоту не больше 65535 пикселей");
  }

  if (image.data.length < width * height * 4) {
    throw new Error("Недостаточно пиксельных данных для GB7");
  }
}

export function encodeGB7(image: EncodedImage): ArrayBuffer {
  validateGB7Image(image);

  const { width, height, data } = image;
  const hasMask = image.hasMask ?? true;
  const buffer = new ArrayBuffer(12 + width * height);
  const view = new DataView(buffer);
  const pixels = new Uint8ClampedArray(buffer, 12);

  view.setUint32(0, 0x4742371d, false);
  view.setUint8(4, 1);
  view.setUint8(5, hasMask ? 1 : 0);
  view.setUint16(6, width, false);
  view.setUint16(8, height, false);
  view.setUint16(10, 0, false);

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;

    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];

    const gray8 = (r + g + b) / 3;
    const gray7 = Math.round((gray8 / 255) * 127);

    const maskBit = hasMask && a > 0 ? 1 : 0;

    const byte = hasMask ? (maskBit << 7) | gray7 : gray7;

    pixels[i] = byte;
  }

  return buffer;
}
