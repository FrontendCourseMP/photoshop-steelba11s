import { validateRaster, yieldToUI } from './raster.js';

export const kernelPresets = {
  identity: { name: 'Тождественное отображение', values: ['0', '0', '0', '0', '1', '0', '0', '0', '0'] },
  sharpen: { name: 'Повышение резкости', values: ['0', '-1', '0', '-1', '5', '-1', '0', '-1', '0'] },
  gaussian: { name: 'Гаусс 3×3', values: ['1/16', '2/16', '1/16', '2/16', '4/16', '2/16', '1/16', '2/16', '1/16'] },
  box: { name: 'Прямоугольное размытие', values: Array(9).fill('1/9') },
  prewittX: { name: 'Прюитт · X', values: ['-1', '0', '1', '-1', '0', '1', '-1', '0', '1'] },
  prewittY: { name: 'Прюитт · Y', values: ['-1', '-1', '-1', '0', '0', '0', '1', '1', '1'] },
};

export function parseCoefficient(text) {
  const parts = text.trim().replaceAll(',', '.').split('/').map(part => part.trim());
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if (parts.length > 2 || parts.some(part => !number.test(part))) throw new Error('Введите число или дробь, например 1/9.');
  const value = Number(parts[0]) / (parts.length === 2 ? Number(parts[1]) : 1);
  if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error('Коэффициент должен быть конечным числом от −1 000 000 до 1 000 000.');
  return value;
}

export async function convolveRaster(source, { kernel, channels, padding }, { cancelled = () => false, onProgress = () => {} } = {}) {
  validateRaster(source);
  if (!Array.isArray(kernel) || kernel.length !== 9 || kernel.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Ядро должно содержать 9 конечных коэффициентов.');
  if (!Array.isArray(channels) || !channels.length || channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 3)) throw new Error('Выберите хотя бы один канал.');
  if (!['black', 'white', 'replicate'].includes(padding)) throw new Error('Неизвестный способ заполнения края.');
  if (cancelled()) return null;
  const selected = [...new Set(channels)];
  const { width, height } = source;
  const data = new Uint8ClampedArray(source.data.length);
  const stages = 1 + selected.length * 2;
  const report = (stage, portion, phase) => onProgress((stage + portion) / stages, phase);
  for (let start = 0; start < data.length; start += 1048576) {
    if (cancelled()) return null;
    const end = Math.min(start + 1048576, data.length);
    data.set(source.data.subarray(start, end), start);
    report(0, end / data.length, 'copy');
    await yieldToUI();
  }

  const stride = width + 2;
  const padded = new Uint8Array(stride * (height + 2));
  const rowsPerBatch = Math.max(1, Math.floor(65536 / stride));
  // Reversing the kernel implements convolution, rather than cross-correlation.
  const weights = [...kernel].reverse();
  const offsets = [0, 1, 2, stride, stride + 1, stride + 2, stride * 2, stride * 2 + 1, stride * 2 + 2];
  for (let channelIndex = 0; channelIndex < selected.length; channelIndex++) {
    const channel = selected[channelIndex];
    for (let start = 0; start < height + 2; start += rowsPerBatch) {
      if (cancelled()) return null;
      const end = Math.min(start + rowsPerBatch, height + 2);
      for (let y = start; y < end; y++) {
        const sy = Math.max(0, Math.min(height - 1, y - 1));
        for (let x = 0; x < stride; x++) {
          const outside = x === 0 || x === stride - 1 || y === 0 || y === height + 1;
          const sx = Math.max(0, Math.min(width - 1, x - 1));
          padded[y * stride + x] = outside && padding !== 'replicate' ? (padding === 'white' ? 255 : 0) : source.data[(sy * width + sx) * 4 + channel];
        }
      }
      report(1 + channelIndex * 2, end / (height + 2), 'padding');
      await yieldToUI();
    }
    for (let start = 0; start < height; start += rowsPerBatch) {
      if (cancelled()) return null;
      const end = Math.min(start + rowsPerBatch, height);
      for (let y = start; y < end; y++) {
        for (let x = 0; x < width; x++) {
          const base = y * stride + x;
          let sum = 0;
          for (let k = 0; k < 9; k++) sum += weights[k] * padded[base + offsets[k]];
          data[(y * width + x) * 4 + channel] = Math.round(sum);
        }
      }
      report(2 + channelIndex * 2, end / height, 'convolution');
      await yieldToUI();
    }
  }
  return cancelled() ? null : { width, height, data };
}
