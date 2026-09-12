import { luminance, yieldToUI } from './raster.js';

export const levelChannels = ['master', 'red', 'green', 'blue', 'alpha'];
export const defaultLevels = (max = 255) => Object.fromEntries(levelChannels.map(channel => [channel, { black: 0, white: max, gamma: 1 }]));

export async function buildHistograms(source, max = 255, cancelled = () => false) {
  const histograms = Object.fromEntries(levelChannels.map(channel => [channel, new Uint32Array(max + 1)]));
  const { data } = source;
  for (let start = 0; start < data.length; start += 524288) {
    if (cancelled()) return null;
    for (let i = start; i < Math.min(start + 524288, data.length); i += 4) {
      histograms.master[Math.round(luminance(data[i], data[i + 1], data[i + 2]) * max / 255)]++;
      histograms.red[Math.round(data[i] * max / 255)]++;
      histograms.green[Math.round(data[i + 1] * max / 255)]++;
      histograms.blue[Math.round(data[i + 2] * max / 255)]++;
      histograms.alpha[Math.round(data[i + 3] * max / 255)]++;
    }
    await yieldToUI();
  }
  return cancelled() ? null : histograms;
}

function levelTable({ black, white, gamma }, max) {
  const table = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value++) {
    const normalized = Math.max(0, Math.min(1, (value * max / 255 - black) / (white - black)));
    table[value] = 255 * normalized ** (1 / gamma);
  }
  return table;
}

export async function applyLevels(source, settings, max = 255, cancelled = () => false) {
  const tables = Object.fromEntries(levelChannels.map(channel => [channel, levelTable(settings[channel], max)]));
  const data = new Uint8ClampedArray(source.data.length);
  for (let start = 0; start < data.length; start += 1048576) {
    if (cancelled()) return null;
    for (let i = start; i < Math.min(start + 1048576, data.length); i += 4) {
      data[i] = tables.red[tables.master[source.data[i]]];
      data[i + 1] = tables.green[tables.master[source.data[i + 1]]];
      data[i + 2] = tables.blue[tables.master[source.data[i + 2]]];
      data[i + 3] = tables.alpha[source.data[i + 3]];
    }
    await yieldToUI();
  }
  return cancelled() ? null : { width: source.width, height: source.height, data };
}
