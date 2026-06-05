import { resizeImageData } from "../core/imageScale";

export type ChannelKey = "r" | "g" | "b" | "a" | "gray";
export type ChannelMode = "rgb" | "gray";

export type ChannelVisibility = Record<ChannelKey, boolean>;

export const DEFAULT_CHANNEL_VISIBILITY: ChannelVisibility = {
  r: true,
  g: true,
  b: true,
  a: true,
  gray: true,
};

export function applyChannelVisibility(
  sourceData: Uint8ClampedArray,
  visibility: ChannelVisibility,
  hasAlphaChannel: boolean,
  channelMode: ChannelMode
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(sourceData.length);

  for (let i = 0; i < sourceData.length; i += 4) {
    const srcR = sourceData[i];
    const srcG = sourceData[i + 1];
    const srcB = sourceData[i + 2];

    if (channelMode === "gray") {
      const grayValue = Math.round((srcR + srcG + srcB) / 3);
      const visibleGray = visibility.gray ? grayValue : 0;
      output[i] = visibleGray;
      output[i + 1] = visibleGray;
      output[i + 2] = visibleGray;
    } else {
      output[i] = visibility.r ? srcR : 0;
      output[i + 1] = visibility.g ? srcG : 0;
      output[i + 2] = visibility.b ? srcB : 0;
    }

    output[i + 3] = hasAlphaChannel
      ? visibility.a
        ? sourceData[i + 3]
        : 255
      : 255;
  }

  return output;
}

function createChannelImageData(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  channel: ChannelKey
): ImageData {
  const output = new Uint8ClampedArray(sourceData.length);

  for (let i = 0; i < sourceData.length; i += 4) {
    const r = sourceData[i];
    const g = sourceData[i + 1];
    const b = sourceData[i + 2];
    const a = sourceData[i + 3];

    if (channel === "r") {
      output[i] = r;
      output[i + 1] = 0;
      output[i + 2] = 0;
      output[i + 3] = 255;
      continue;
    }

    if (channel === "g") {
      output[i] = 0;
      output[i + 1] = g;
      output[i + 2] = 0;
      output[i + 3] = 255;
      continue;
    }

    if (channel === "b") {
      output[i] = 0;
      output[i + 1] = 0;
      output[i + 2] = b;
      output[i + 3] = 255;
      continue;
    }

    if (channel === "gray") {
      const gray = Math.round((r + g + b) / 3);
      output[i] = gray;
      output[i + 1] = gray;
      output[i + 2] = gray;
      output[i + 3] = 255;
      continue;
    }

    output[i] = a;
    output[i + 1] = a;
    output[i + 2] = a;
    output[i + 3] = 255;
  }

  return new ImageData(output, width, height);
}

export function createChannelThumbnail(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  channel: ChannelKey,
  thumbSize = 72
): string | null {
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbSize;
  thumbCanvas.height = thumbSize;
  const thumbContext = thumbCanvas.getContext("2d");
  if (!thumbContext) {
    return null;
  }

  thumbContext.fillStyle = "#1a1a1a";
  thumbContext.fillRect(0, 0, thumbSize, thumbSize);

  const ratio = Math.min(thumbSize / width, thumbSize / height);
  const drawWidth = Math.max(1, Math.floor(width * ratio));
  const drawHeight = Math.max(1, Math.floor(height * ratio));
  const x = Math.floor((thumbSize - drawWidth) / 2);
  const y = Math.floor((thumbSize - drawHeight) / 2);
  const channelImageData = createChannelImageData(sourceData, width, height, channel);
  const resizedData = resizeImageData(
    channelImageData.data,
    width,
    height,
    drawWidth,
    drawHeight,
    "bilinear"
  );

  thumbContext.putImageData(
    new ImageData(new Uint8ClampedArray(resizedData), drawWidth, drawHeight),
    x,
    y
  );

  return thumbCanvas.toDataURL("image/png");
}
