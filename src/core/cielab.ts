export type CielabColor = {
  l: number;
  a: number;
  b: number;
};

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function xyzPivot(value: number): number {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;

  return value > epsilon
    ? Math.cbrt(value)
    : (kappa * value + 16) / 116;
}

export function rgbToCielab(r: number, g: number, b: number): CielabColor {
  const linearR = srgbToLinear(r);
  const linearG = srgbToLinear(g);
  const linearB = srgbToLinear(b);

  const x =
    linearR * 0.4124564 + linearG * 0.3575761 + linearB * 0.1804375;
  const y =
    linearR * 0.2126729 + linearG * 0.7151522 + linearB * 0.072175;
  const z =
    linearR * 0.0193339 + linearG * 0.119192 + linearB * 0.9503041;

  const refX = 0.95047;
  const refY = 1;
  const refZ = 1.08883;

  const fx = xyzPivot(x / refX);
  const fy = xyzPivot(y / refY);
  const fz = xyzPivot(z / refZ);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}
