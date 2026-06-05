export type InterpolationMethod = "nearest" | "bilinear";

type PixelSampler = (
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
) => number;

export type InterpolationAlgorithm = {
  label: string;
  description: string;
  advantage: string;
  sample: PixelSampler;
};

const BYTE_MIN = 0;
const BYTE_MAX = 255;

function clampByte(value: number): number {
  return Math.min(BYTE_MAX, Math.max(BYTE_MIN, Math.round(value)));
}

function clampCoordinate(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

function getPixelChannel(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  const safeX = clampCoordinate(x, sourceWidth - 1);
  const safeY = clampCoordinate(y, sourceHeight - 1);
  return sourceData[(safeY * sourceWidth + safeX) * 4 + channel];
}

function targetToSourceCoordinate(
  targetIndex: number,
  sourceSize: number,
  targetSize: number
): number {
  if (targetSize <= 1) {
    return (sourceSize - 1) / 2;
  }
  return ((targetIndex + 0.5) * sourceSize) / targetSize - 0.5;
}

function nearestNeighborSample(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  return getPixelChannel(
    sourceData,
    sourceWidth,
    sourceHeight,
    Math.round(x),
    Math.round(y),
    channel
  );
}

function bilinearSample(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  channel: number
): number {
  const safeX = clampCoordinate(x, sourceWidth - 1);
  const safeY = clampCoordinate(y, sourceHeight - 1);
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(sourceWidth - 1, x0 + 1);
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const wx = safeX - x0;
  const wy = safeY - y0;

  const topLeft = getPixelChannel(sourceData, sourceWidth, sourceHeight, x0, y0, channel);
  const topRight = getPixelChannel(sourceData, sourceWidth, sourceHeight, x1, y0, channel);
  const bottomLeft = getPixelChannel(sourceData, sourceWidth, sourceHeight, x0, y1, channel);
  const bottomRight = getPixelChannel(sourceData, sourceWidth, sourceHeight, x1, y1, channel);

  const top = topLeft * (1 - wx) + topRight * wx;
  const bottom = bottomLeft * (1 - wx) + bottomRight * wx;
  return top * (1 - wy) + bottom * wy;
}

export const INTERPOLATION_ALGORITHMS: Record<
  InterpolationMethod,
  InterpolationAlgorithm
> = {
  nearest: {
    label: "Ближайший сосед",
    description: "Берет цвет ближайшего исходного пикселя без смешивания.",
    advantage: "Очень быстрый и сохраняет резкие границы, но может давать ступеньки.",
    sample: nearestNeighborSample,
  },
  bilinear: {
    label: "Билинейная",
    description: "Смешивает четыре ближайших пикселя по горизонтали и вертикали.",
    advantage: "Дает более плавное изображение и подходит как метод по умолчанию.",
    sample: bilinearSample,
  },
};

export function resizeImageData(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  method: InterpolationMethod = "bilinear"
): Uint8ClampedArray {
  return resizeImageDataRegion(
    sourceData,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    0,
    0,
    targetWidth,
    targetHeight,
    method
  );
}

export function resizeImageDataRegion(
  sourceData: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  regionX: number,
  regionY: number,
  regionWidth: number,
  regionHeight: number,
  method: InterpolationMethod = "bilinear"
): Uint8ClampedArray {
  const safeSourceWidth = Math.round(sourceWidth);
  const safeSourceHeight = Math.round(sourceHeight);
  const safeTargetWidth = Math.max(1, Math.round(targetWidth));
  const safeTargetHeight = Math.max(1, Math.round(targetHeight));
  const safeRegionX = Math.max(0, Math.round(regionX));
  const safeRegionY = Math.max(0, Math.round(regionY));
  const safeRegionWidth = Math.max(1, Math.round(regionWidth));
  const safeRegionHeight = Math.max(1, Math.round(regionHeight));
  const algorithm = INTERPOLATION_ALGORITHMS[method];

  if (!algorithm) {
    throw new Error(`Unknown interpolation method: ${method}`);
  }
  if (safeSourceWidth <= 0 || safeSourceHeight <= 0) {
    throw new Error("Source image dimensions must be positive");
  }
  if (sourceData.length < safeSourceWidth * safeSourceHeight * 4) {
    throw new Error("Source data is smaller than image dimensions require");
  }

  const output = new Uint8ClampedArray(safeRegionWidth * safeRegionHeight * 4);

  for (let y = 0; y < safeRegionHeight; y += 1) {
    const targetY = safeRegionY + y;
    const sourceY = targetToSourceCoordinate(targetY, safeSourceHeight, safeTargetHeight);
    for (let x = 0; x < safeRegionWidth; x += 1) {
      const targetX = safeRegionX + x;
      const sourceX = targetToSourceCoordinate(targetX, safeSourceWidth, safeTargetWidth);
      const targetOffset = (y * safeRegionWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        output[targetOffset + channel] = clampByte(
          algorithm.sample(
            sourceData,
            safeSourceWidth,
            safeSourceHeight,
            sourceX,
            sourceY,
            channel
          )
        );
      }
    }
  }

  return output;
}
