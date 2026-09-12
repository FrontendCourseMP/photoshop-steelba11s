import { inspectFormat } from './metadata.js';
import { decodeGrayBit, encodeGrayBit } from './graybit.js';
import { validateSize } from '../domain/raster.js';

export async function readImage(file) {
  if (file.size > 160 * 1024 * 1024) throw new Error('Размер файла превышает 160 МБ.');
  const buffer = await file.arrayBuffer();
  const metadata = inspectFormat(buffer);
  if (metadata.format === 'GB7') return decodeGrayBit(buffer);
  const type = metadata.format === 'PNG' ? 'image/png' : 'image/jpeg';
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // The browser applies EXIF orientation before the image enters the document.
    const width = image.naturalWidth, height = image.naturalHeight;
    validateSize(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    canvas.width = canvas.height = 1;
    return { width, height, data, metadata };
  } catch (error) {
    throw new Error(`Не удалось прочитать изображение. ${error.message}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageBlob(raster, format) {
  if (format === 'gb7') return new Blob([await encodeGrayBit(raster)], { type: 'application/octet-stream' });
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  if (format === 'jpg') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, raster.width, raster.height);
  }
  try {
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Браузер не смог сохранить изображение.')), format === 'jpg' ? 'image/jpeg' : 'image/png', 0.94));
  } finally {
    canvas.width = canvas.height = 1;
  }
}
