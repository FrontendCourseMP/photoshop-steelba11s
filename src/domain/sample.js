export function makeSample() {
  const width = 900, height = 600;
  const data = new Uint8ClampedArray(width * height * 4);
  const palette = [[231, 75, 78], [238, 181, 52], [62, 171, 129], [46, 140, 205], [169, 104, 194], [240, 240, 240]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let color;
      if (y < 170) color = palette[Math.min(5, Math.floor(x / 150))];
      else if (y > 450) { const v = Math.round(x * 255 / (width - 1)); color = [v, v, v]; }
      else color = [Math.round(x * 255 / (width - 1)), Math.round((y - 170) * 255 / 280), Math.round(255 - x * 255 / (width - 1))];
      data.set(color, i);
      data[i + 3] = y > 530 ? Math.round(x * 255 / (width - 1)) : 255;
      if (y >= 215 && y < 405 && x >= 355 && x < 545) {
        const ring = Math.hypot(x - 450, y - 310);
        if (ring < 83) data.set(ring > 61 ? [250, 250, 250, 255] : [32, 35, 33, 255], i);
      }
    }
  }
  return { width, height, data, metadata: { format: 'RGBA', model: 'RGBA', depth: '32 бит (RGB + Alpha)' } };
}
