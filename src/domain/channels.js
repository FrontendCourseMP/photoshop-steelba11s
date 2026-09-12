import { yieldToUI } from './raster.js';

const definitions = {
  gray: { id: 'gray', name: 'Серый', short: 'Gray', index: 0 },
  red: { id: 'red', name: 'Красный', short: 'R', index: 0 },
  green: { id: 'green', name: 'Зелёный', short: 'G', index: 1 },
  blue: { id: 'blue', name: 'Синий', short: 'B', index: 2 },
  alpha: { id: 'alpha', name: 'Прозрачность', short: 'A', index: 3 },
};

export function channelsFor(model) {
  const ids = model.startsWith('RGB') ? ['red', 'green', 'blue'] : ['gray'];
  if (model.endsWith('A')) ids.push('alpha');
  return ids.map(id => definitions[id]);
}

export async function composeChannels(raster, model, enabled, isCancelled = () => false) {
  const output = new Uint8ClampedArray(raster.data.length);
  const gray = model.startsWith('G');
  const hasAlpha = model.endsWith('A');
  const alphaOnly = hasAlpha && enabled.has('alpha') && enabled.size === 1;
  const red = enabled.has(gray ? 'gray' : 'red');
  const green = enabled.has(gray ? 'gray' : 'green');
  const blue = enabled.has(gray ? 'gray' : 'blue');
  for (let start = 0; start < output.length; start += 1048576) {
    if (isCancelled()) return null;
    for (let i = start; i < Math.min(start + 1048576, output.length); i += 4) {
      if (alphaOnly) {
        output[i] = output[i + 1] = output[i + 2] = raster.data[i + 3];
        output[i + 3] = 255;
      } else {
        output[i] = red ? raster.data[i] : 0;
        output[i + 1] = green ? raster.data[i + 1] : 0;
        output[i + 2] = blue ? raster.data[i + 2] : 0;
        output[i + 3] = hasAlpha && enabled.has('alpha') ? raster.data[i + 3] : 255;
      }
    }
    await yieldToUI();
  }
  if (isCancelled()) return null;
  return { width: raster.width, height: raster.height, data: output };
}

export function channelThumbnail(raster, index, size = 48) {
  const scale = Math.min(size / raster.width, size / raster.height);
  const width = Math.max(1, Math.round(raster.width * scale));
  const height = Math.max(1, Math.round(raster.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(raster.width - 1, Math.floor((x + 0.5) * raster.width / width));
      const sy = Math.min(raster.height - 1, Math.floor((y + 0.5) * raster.height / height));
      const value = raster.data[(sy * raster.width + sx) * 4 + index];
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
