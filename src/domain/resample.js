import { validateSize, yieldToUI } from './raster.js';

const clamp = (value, max) => Math.max(0, Math.min(max, value));

function nearest(source, x, y, output, index) {
  const offset = (clamp(Math.round(y), source.height - 1) * source.width + clamp(Math.round(x), source.width - 1)) * 4;
  for (let c = 0; c < 4; c++) output[index + c] = source.data[offset + c];
}

function bilinear(source, x, y, output, index) {
  x = clamp(x, source.width - 1);
  y = clamp(y, source.height - 1);
  const left = Math.floor(x), top = Math.floor(y);
  const right = Math.min(left + 1, source.width - 1), bottom = Math.min(top + 1, source.height - 1);
  const fx = x - left, fy = y - top;
  const a = (top * source.width + left) * 4, b = (top * source.width + right) * 4;
  const c = (bottom * source.width + left) * 4, d = (bottom * source.width + right) * 4;
  const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
  const pixels = source.data;
  const alpha = pixels[a + 3] * wa + pixels[b + 3] * wb + pixels[c + 3] * wc + pixels[d + 3] * wd;
  output[index + 3] = alpha;
  // Interpolate premultiplied color to avoid dark fringes around transparent pixels.
  for (let channel = 0; channel < 3; channel++) {
    output[index + channel] = alpha > 0 ? (
      pixels[a + channel] * pixels[a + 3] * wa + pixels[b + channel] * pixels[b + 3] * wb +
      pixels[c + channel] * pixels[c + 3] * wc + pixels[d + channel] * pixels[d + 3] * wd
    ) / alpha : 0;
  }
}

export const interpolationMethods = {
  nearest: { name: 'Ближайший сосед', sample: nearest, description: 'Берёт ближайший пиксель. Сохраняет резкие границы и палитру, подходит для пиксельной графики.' },
  bilinear: { name: 'Билинейная', sample: bilinear, description: 'Смешивает четыре соседних пикселя. Даёт плавные переходы и меньше ступенчатых границ на фотографиях.' },
};

export async function resampleRegion(source, width, height, region, method = 'bilinear', cancelled = () => false) {
  validateSize(region.width, region.height);
  const sampler = interpolationMethods[method]?.sample;
  if (!sampler) throw new Error('Неизвестный алгоритм интерполяции.');
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  const scaleX = source.width / width, scaleY = source.height / height;
  const rows = Math.max(1, Math.floor(65536 / region.width));
  for (let start = 0; start < region.height; start += rows) {
    if (cancelled()) return null;
    for (let y = start; y < Math.min(start + rows, region.height); y++) {
      const sy = (region.y + y + 0.5) * scaleY - 0.5;
      for (let x = 0; x < region.width; x++) {
        sampler(source, (region.x + x + 0.5) * scaleX - 0.5, sy, data, (y * region.width + x) * 4);
      }
    }
    await yieldToUI();
  }
  return cancelled() ? null : { width: region.width, height: region.height, data };
}

export function resizeRaster(source, width, height, method = 'bilinear', cancelled) {
  validateSize(width, height);
  return resampleRegion(source, width, height, { x: 0, y: 0, width, height }, method, cancelled);
}
