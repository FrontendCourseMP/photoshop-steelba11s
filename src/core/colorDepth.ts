const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type ImageColorInfo = {
  colorDepthBits: number;
  hasAlphaChannel: boolean;
};

export async function detectPngColorDepthBits(
  file: File
): Promise<number | null> {
  const info = await detectPngColorInfo(file);
  return info?.colorDepthBits ?? null;
}

export async function detectPngColorInfo(
  file: File
): Promise<ImageColorInfo | null> {
  const header = new Uint8Array(await file.slice(0, 29).arrayBuffer());
  if (header.length < 29) {
    return null;
  }

  const isPng = PNG_SIGNATURE.every((byte, index) => header[index] === byte);
  if (!isPng) {
    return null;
  }

  const isIhdrChunk =
    header[12] === 73 &&
    header[13] === 72 &&
    header[14] === 68 &&
    header[15] === 82;
  if (!isIhdrChunk) {
    return null;
  }

  const bitDepthPerChannel = header[24];
  const colorType = header[25];
  const channelsByColorType: Record<number, number> = {
    0: 1,
    2: 3,
    3: 1,
    4: 2,
    6: 4,
  };
  const channels = channelsByColorType[colorType];
  if (!channels) {
    return null;
  }

  return {
    colorDepthBits: bitDepthPerChannel * channels,
    hasAlphaChannel: (colorType & 0b100) !== 0,
  };
}

export async function detectJpegColorDepthBits(
  file: File
): Promise<number | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);

  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      continue;
    }

    if (offset + 1 >= bytes.length) {
      break;
    }

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (sofMarkers.has(marker) && segmentLength >= 8) {
      const precision = bytes[offset + 2];
      const components = bytes[offset + 7];
      return precision * components;
    }

    offset += segmentLength;
  }

  return null;
}

export async function detectImageColorDepthBits(
  file: File,
  fileName: string
): Promise<number> {
  const info = await detectImageColorInfo(file, fileName);
  return info.colorDepthBits;
}

export async function detectImageColorInfo(
  file: File,
  fileName: string
): Promise<ImageColorInfo> {
  const isPng = file.type === "image/png" || fileName.endsWith(".png");
  if (isPng) {
    const pngInfo = await detectPngColorInfo(file);
    return (
      pngInfo ?? {
        colorDepthBits: 32,
        hasAlphaChannel: true,
      }
    );
  }

  const isJpeg =
    file.type === "image/jpeg" ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg");
  if (isJpeg) {
    const jpegDepth = await detectJpegColorDepthBits(file);
    return {
      colorDepthBits: jpegDepth ?? 24,
      hasAlphaChannel: false,
    };
  }

  return {
    colorDepthBits: 24,
    hasAlphaChannel: false,
  };
}
