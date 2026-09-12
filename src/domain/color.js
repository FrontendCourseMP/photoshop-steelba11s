// sRGB -> linear RGB -> XYZ (D65) -> CIELAB.
export function rgbToLab(r, g, b) {
  const linear = value => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = linear(r), G = linear(g), B = linear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const delta = 6 / 29;
  const f = v => v > delta ** 3 ? Math.cbrt(v) : v / (3 * delta ** 2) + 4 / 29;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function pixelAt(raster, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= raster.width || y >= raster.height) return null;
  const offset = (y * raster.width + x) * 4;
  return Array.from(raster.data.subarray(offset, offset + 4));
}
