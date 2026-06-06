export type FilterChannel = "r" | "g" | "b" | "a" | "gray";
export type EdgeHandling = "black" | "white" | "copy";
export type FilterMode = "kernel" | "median";

export type FilterPresetKey =
  | "custom"
  | "identity"
  | "sharpen"
  | "gaussian"
  | "boxBlur"
  | "prewittX"
  | "prewittY"
  | "median";

export type KernelPreset = {
  key: FilterPresetKey;
  label: string;
  mode: FilterMode;
  kernel: number[];
  normalize: boolean;
};

export type ApplyFilterOptions = {
  sourceData: Uint8ClampedArray;
  width: number;
  height: number;
  kernel: number[];
  mode: FilterMode;
  channels: FilterChannel[];
  edgeHandling: EdgeHandling;
  normalizeKernelSum?: boolean;
  yieldEveryRows?: number;
};

const CHANNEL_OFFSETS: Record<Exclude<FilterChannel, "gray">, number> = {
  r: 0,
  g: 1,
  b: 2,
  a: 3,
};

const FILTER_YIELD_DELAY_MS = 0;

export const FILTER_KERNEL_SIZE = 3;
export const FILTER_KERNEL_VALUE_COUNT = FILTER_KERNEL_SIZE * FILTER_KERNEL_SIZE;

export const FILTER_PRESETS: KernelPreset[] = [
  {
    key: "custom",
    label: "Пользовательская",
    mode: "kernel",
    kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    normalize: false,
  },
  {
    key: "identity",
    label: "Тождественное отображение",
    mode: "kernel",
    kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    normalize: false,
  },
  {
    key: "sharpen",
    label: "Повышение резкости",
    mode: "kernel",
    kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    normalize: false,
  },
  {
    key: "gaussian",
    label: "Фильтр Гаусса 3x3",
    mode: "kernel",
    kernel: [1, 2, 1, 2, 4, 2, 1, 2, 1],
    normalize: true,
  },
  {
    key: "boxBlur",
    label: "Прямоугольное размытие",
    mode: "kernel",
    kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    normalize: true,
  },
  {
    key: "prewittX",
    label: "Оператор Прюитта X",
    mode: "kernel",
    kernel: [-1, 0, 1, -1, 0, 1, -1, 0, 1],
    normalize: false,
  },
  {
    key: "prewittY",
    label: "Оператор Прюитта Y",
    mode: "kernel",
    kernel: [-1, -1, -1, 0, 0, 0, 1, 1, 1],
    normalize: false,
  },
  {
    key: "median",
    label: "Медианная фильтрация 3x3",
    mode: "median",
    kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    normalize: false,
  },
];

export const DEFAULT_FILTER_PRESET = FILTER_PRESETS[1];

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function delay(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, FILTER_YIELD_DELAY_MS));
}

function getOutsideValue(edgeHandling: EdgeHandling): number {
  if (edgeHandling === "white") {
    return 255;
  }
  return 0;
}

function getChannelValue(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channelOffset: number,
  edgeHandling: EdgeHandling
): number {
  if (x >= 0 && y >= 0 && x < width && y < height) {
    return sourceData[(y * width + x) * 4 + channelOffset];
  }

  if (edgeHandling !== "copy") {
    return getOutsideValue(edgeHandling);
  }

  const safeX = Math.min(width - 1, Math.max(0, x));
  const safeY = Math.min(height - 1, Math.max(0, y));
  return sourceData[(safeY * width + safeX) * 4 + channelOffset];
}

function getKernelDivisor(kernel: number[], normalizeKernelSum = false): number {
  if (!normalizeKernelSum) {
    return 1;
  }

  const sum = kernel.reduce((total, value) => total + value, 0);
  return sum === 0 ? 1 : sum;
}

function applyKernelAtPixel(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channelOffset: number,
  kernel: number[],
  edgeHandling: EdgeHandling,
  divisor: number
): number {
  let total = 0;
  let kernelIndex = 0;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      total +=
        getChannelValue(
          sourceData,
          width,
          height,
          x + dx,
          y + dy,
          channelOffset,
          edgeHandling
        ) * kernel[kernelIndex];
      kernelIndex += 1;
    }
  }

  return clampByte(total / divisor);
}

function applyMedianAtPixel(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channelOffset: number,
  edgeHandling: EdgeHandling
): number {
  const values: number[] = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      values.push(
        getChannelValue(
          sourceData,
          width,
          height,
          x + dx,
          y + dy,
          channelOffset,
          edgeHandling
        )
      );
    }
  }

  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function applyFilterAtPixelChannel(
  options: ApplyFilterOptions,
  x: number,
  y: number,
  channelOffset: number,
  divisor: number
): number {
  if (options.mode === "median") {
    return applyMedianAtPixel(
      options.sourceData,
      options.width,
      options.height,
      x,
      y,
      channelOffset,
      options.edgeHandling
    );
  }

  return applyKernelAtPixel(
    options.sourceData,
    options.width,
    options.height,
    x,
    y,
    channelOffset,
    options.kernel,
    options.edgeHandling,
    divisor
  );
}

export function normalizeKernel(kernel: number[]): number[] {
  const normalized = kernel.slice(0, FILTER_KERNEL_VALUE_COUNT).map((value) =>
    Number.isFinite(value) ? value : 0
  );

  while (normalized.length < FILTER_KERNEL_VALUE_COUNT) {
    normalized.push(0);
  }

  return normalized;
}

export async function applyImageFilter(options: ApplyFilterOptions): Promise<Uint8ClampedArray> {
  const safeWidth = Math.round(options.width);
  const safeHeight = Math.round(options.height);
  const kernel = normalizeKernel(options.kernel);
  const selectedChannels = new Set(options.channels);
  const yieldEveryRows = Math.max(1, Math.round(options.yieldEveryRows ?? 24));

  if (safeWidth <= 0 || safeHeight <= 0) {
    throw new Error("Image dimensions must be positive");
  }
  if (options.sourceData.length < safeWidth * safeHeight * 4) {
    throw new Error("Source data is smaller than image dimensions require");
  }
  if (selectedChannels.size === 0) {
    return new Uint8ClampedArray(options.sourceData);
  }

  const output = new Uint8ClampedArray(options.sourceData);
  const divisor = getKernelDivisor(kernel, options.normalizeKernelSum);

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const outputOffset = (y * safeWidth + x) * 4;

      if (selectedChannels.has("gray")) {
        const filteredGray = applyFilterAtPixelChannel(
          { ...options, kernel },
          x,
          y,
          CHANNEL_OFFSETS.r,
          divisor
        );
        output[outputOffset] = filteredGray;
        output[outputOffset + 1] = filteredGray;
        output[outputOffset + 2] = filteredGray;
      } else {
        (["r", "g", "b"] as const).forEach((channel) => {
          if (!selectedChannels.has(channel)) {
            return;
          }

          const channelOffset = CHANNEL_OFFSETS[channel];
          output[outputOffset + channelOffset] = applyFilterAtPixelChannel(
            { ...options, kernel },
            x,
            y,
            channelOffset,
            divisor
          );
        });
      }

      if (selectedChannels.has("a")) {
        output[outputOffset + CHANNEL_OFFSETS.a] = applyFilterAtPixelChannel(
          { ...options, kernel },
          x,
          y,
          CHANNEL_OFFSETS.a,
          divisor
        );
      }
    }

    if (y > 0 && y % yieldEveryRows === 0) {
      await delay();
    }
  }

  return output;
}
