export type LevelsTarget = "master" | "r" | "g" | "b" | "a" | "gray";
export type HistogramScale = "linear" | "log";
type HistogramMasterMode = "luminance" | "gray";

export type LevelsSettings = {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
};

export type HistogramOptions = {
  masterMode?: HistogramMasterMode;
};

const BYTE_MIN = 0;
const BYTE_MAX = 255;

function clampByte(value: number): number {
  return Math.min(BYTE_MAX, Math.max(BYTE_MIN, Math.round(value)));
}

function srgbToLinear(value: number): number {
  const normalized = value / BYTE_MAX;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function getMasterLuminanceBin(r: number, g: number, b: number): number {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const luminance = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  return clampByte(luminance * BYTE_MAX);
}

function getGrayBin(r: number, g: number, b: number): number {
  return clampByte((r + g + b) / 3);
}

function mapLevelValue(value: number, settings: LevelsSettings): number {
  const inputBlack = clampByte(settings.inputBlack);
  const inputWhite = clampByte(settings.inputWhite);
  const gamma = Math.min(9.99, Math.max(0.1, settings.gamma));
  const safeWhite = inputWhite <= inputBlack ? inputBlack + 1 : inputWhite;

  const normalized = Math.min(
    1,
    Math.max(0, (value - inputBlack) / (safeWhite - inputBlack))
  );
  const corrected = Math.pow(normalized, gamma);
  return clampByte(corrected * BYTE_MAX);
}

function buildLevelsLut(settings: LevelsSettings): Uint8Array {
  const lut = new Uint8Array(256);
  for (let value = 0; value <= BYTE_MAX; value += 1) {
    lut[value] = mapLevelValue(value, settings);
  }
  return lut;
}

export function buildHistogram(
  data: Uint8ClampedArray,
  target: LevelsTarget,
  options: HistogramOptions = {}
): Uint32Array {
  const bins = new Uint32Array(256);
  const masterMode = options.masterMode ?? "luminance";

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    let value = 0;
    if (target === "master") {
      value =
        masterMode === "gray"
          ? getGrayBin(r, g, b)
          : getMasterLuminanceBin(r, g, b);
    } else if (target === "r") {
      value = r;
    } else if (target === "g") {
      value = g;
    } else if (target === "b") {
      value = b;
    } else if (target === "a") {
      value = a;
    } else {
      value = getGrayBin(r, g, b);
    }

    bins[value] += 1;
  }

  return bins;
}

export function applyLevelsToData(
  sourceData: Uint8ClampedArray,
  target: LevelsTarget,
  settings: LevelsSettings,
  hasAlphaChannel: boolean
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(sourceData);
  const lut = buildLevelsLut(settings);

  for (let i = 0; i < sourceData.length; i += 4) {
    if (target === "master") {
      output[i] = lut[sourceData[i]];
      output[i + 1] = lut[sourceData[i + 1]];
      output[i + 2] = lut[sourceData[i + 2]];
      continue;
    }

    if (target === "r") {
      output[i] = lut[sourceData[i]];
      continue;
    }

    if (target === "g") {
      output[i + 1] = lut[sourceData[i + 1]];
      continue;
    }

    if (target === "b") {
      output[i + 2] = lut[sourceData[i + 2]];
      continue;
    }

    if (target === "gray") {
      const mapped = lut[sourceData[i]];
      output[i] = mapped;
      output[i + 1] = mapped;
      output[i + 2] = mapped;
      continue;
    }

    if (target === "a" && hasAlphaChannel) {
      output[i + 3] = lut[sourceData[i + 3]];
    }
  }

  return output;
}
