export const MAX_PIXELS = 24_000_000;
export const MAX_SIDE = 16_384;

export function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Размеры изображения должны быть положительными целыми числами.');
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error('Изображение слишком большое: максимум 24 млн пикселей и 16 384 пикселя по стороне.');
  }
}

export function validateRaster({ width, height, data }) {
  validateSize(width, height);
  if (!(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('Повреждены данные пикселей.');
  }
}

export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));
