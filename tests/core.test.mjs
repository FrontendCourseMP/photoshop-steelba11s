import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGrayBit, encodeGrayBit } from '../src/io/graybit.js';
import { inspectFormat } from '../src/io/metadata.js';
import { composeChannels, channelsFor, channelThumbnail } from '../src/domain/channels.js';
import { rgbToLab, pixelAt } from '../src/domain/color.js';
import { validateSize } from '../src/domain/raster.js';

function gb7(width, height, mask, pixels) {
  return Uint8Array.from([71, 66, 55, 29, 1, mask, width >> 8, width & 255, height >> 8, height & 255, 0, 0, ...pixels]).buffer;
}
const raster = (pixels, width = pixels.length / 4, height = 1) => ({ width, height, data: new Uint8ClampedArray(pixels) });

test('GB7: network byte order, row order and 7-bit endpoints', async () => {
  const pixels = Array.from({ length: 258 }, (_, i) => i % 128);
  const result = await decodeGrayBit(gb7(129, 2, 0, pixels));
  assert.equal(result.width, 129);
  assert.equal(result.height, 2);
  assert.deepEqual(pixelAt(result, 127, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixelAt(result, 0, 1), [2, 2, 2, 255]);
  assert.equal(result.metadata.model, 'G');
});

test('GB7: high bit controls mask, low bit remains part of gray', async () => {
  const result = await decodeGrayBit(gb7(4, 1, 1, [0, 127, 128, 255]));
  assert.deepEqual(Array.from(result.data), [0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(result.metadata.model, 'GA');
});

test('GB7: all gray values survive encode-decode, with and without mask', async () => {
  for (const mask of [0, 1]) {
    const input = gb7(128, 1, mask, Array.from({ length: 128 }, (_, i) => i | (mask && i % 2 ? 128 : 0)));
    assert.deepEqual(new Uint8Array(await encodeGrayBit(await decodeGrayBit(input))), new Uint8Array(input));
  }
});

test('GB7: RGB conversion, alpha threshold, canonical header', async () => {
  const bytes = new Uint8Array(await encodeGrayBit(raster([255, 0, 0, 127, 0, 255, 0, 128, 0, 0, 255, 255])));
  assert.deepEqual(Array.from(bytes), [71, 66, 55, 29, 1, 1, 0, 3, 0, 1, 0, 0, 38, 203, 142]);
});

test('GB7 rejects malformed signatures, versions, flags, reserved fields, sizes and pixel data', async () => {
  const valid = new Uint8Array(gb7(1, 1, 0, [127]));
  for (const [index, value] of [[0, 0], [4, 2], [5, 2], [10, 1], [11, 1], [7, 0], [9, 0], [12, 255]]) {
    const bytes = valid.slice(); bytes[index] = value;
    await assert.rejects(decodeGrayBit(bytes.buffer));
  }
  await assert.rejects(decodeGrayBit(valid.slice(0, 11).buffer));
  await assert.rejects(decodeGrayBit(valid.slice(0, 12).buffer));
  await assert.rejects(decodeGrayBit(Uint8Array.from([...valid, 0]).buffer));
});

test('channel models preserve declared alpha and RGB even if image is visually grayscale', () => {
  assert.deepEqual(['G', 'GA', 'RGB', 'RGBA'].map(model => channelsFor(model).map(c => c.id)), [['gray'], ['gray', 'alpha'], ['red', 'green', 'blue'], ['red', 'green', 'blue', 'alpha']]);
});

test('channel combinations isolate colors, alpha-only mask, and do not modify source', async () => {
  const source = raster([100, 150, 200, 64, 10, 20, 30, 255]);
  const before = source.data.slice();
  const red = await composeChannels(source, 'RGBA', new Set(['red']));
  assert.deepEqual(Array.from(red.data), [100, 0, 0, 255, 10, 0, 0, 255]);
  const noGreen = await composeChannels(source, 'RGBA', new Set(['red', 'blue', 'alpha']));
  assert.deepEqual(Array.from(noGreen.data), [100, 0, 200, 64, 10, 0, 30, 255]);
  const alpha = await composeChannels(source, 'RGBA', new Set(['alpha']));
  assert.deepEqual(Array.from(alpha.data), [64, 64, 64, 255, 255, 255, 255, 255]);
  const none = await composeChannels(source, 'RGBA', new Set());
  assert.deepEqual(Array.from(none.data), [0, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual(source.data, before);
});

test('gray + alpha behavior and cancellation', async () => {
  const source = raster([90, 90, 90, 128]);
  assert.deepEqual(Array.from((await composeChannels(source, 'GA', new Set(['gray', 'alpha']))).data), [90, 90, 90, 128]);
  assert.deepEqual(Array.from((await composeChannels(source, 'GA', new Set(['gray']))).data), [90, 90, 90, 255]);
  assert.equal(await composeChannels(source, 'GA', new Set(['gray']), () => true), null);
});

test('channel thumbnails represent component intensity and preserve aspect ratio', () => {
  const source = raster([20, 40, 60, 80, 90, 120, 150, 180]);
  const output = channelThumbnail(source, 1, 2);
  assert.equal(output.width, 2);
  assert.equal(output.height, 1);
  assert.deepEqual(Array.from(output.data), [40, 40, 40, 255, 120, 120, 120, 255]);
});

test('CIELAB matches reference colors within 0.02 (D65)', () => {
  const cases = [[0, 0, 0, 0, 0, 0], [255, 255, 255, 100, 0, 0], [255, 0, 0, 53.2408, 80.0925, 67.2032], [0, 255, 0, 87.7347, -86.1827, 83.1793], [0, 0, 255, 32.2970, 79.1875, -107.8602]];
  for (const [r, g, b, ...expected] of cases) rgbToLab(r, g, b).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < .02, `${r},${g},${b}: ${value} != ${expected[i]}`));
});

test('pipette indexing uses image bounds and row-major coordinates', () => {
  const source = raster([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255], 2, 2);
  assert.deepEqual(pixelAt(source, 0, 1), [0, 0, 255, 255]);
  for (const [x, y] of [[-1, 0], [0, 2], [2, 0], [.5, 0]]) assert.equal(pixelAt(source, x, y), null);
});

function pngHeader(bits, type, trns = false) {
  const bytes = new Uint8Array(trns ? 45 : 33), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 10); view.setUint32(20, 20);
  bytes[24] = bits; bytes[25] = type;
  if (trns) view.setUint32(37, 0x74524e53);
  return bytes.buffer;
}

test('PNG metadata: actual bit depth, palette and explicit/tRNS alpha', () => {
  for (const [bits, type, trns, model, depth] of [[1, 0, false, 'G', '1 бит'], [16, 4, false, 'GA', '32 бит'], [8, 2, false, 'RGB', '24 бит'], [8, 6, false, 'RGBA', '32 бит'], [4, 3, true, 'RGBA', '4 бит'], [8, 0, true, 'GA', '8 бит']]) {
    const info = inspectFormat(pngHeader(bits, type, trns));
    assert.equal(info.model, model);
    assert.ok(info.depth.startsWith(depth));
    assert.equal(info.width, 10);
    assert.equal(info.height, 20);
  }
});

test('JPEG: read SOF components and depth without inventing alpha', () => {
  for (const components of [1, 3, 4]) {
    const header = Uint8Array.from([255, 216, 255, 192, 0, 8, 8, 0, 20, 0, 10, components]);
    const info = inspectFormat(header.buffer);
    assert.equal(info.model, components === 1 ? 'G' : 'RGB');
    assert.ok(info.depth.startsWith(`${components * 8} бит`));
  }
});

test('format and resource validation rejects unknown, truncated and oversized images', () => {
  assert.throws(() => inspectFormat(new ArrayBuffer(0)));
  assert.throws(() => inspectFormat(Uint8Array.from([255, 216, 255, 192, 0, 8]).buffer));
  assert.throws(() => validateSize(0, 1));
  assert.throws(() => validateSize(20000, 1));
  assert.throws(() => validateSize(6000, 5000));
  assert.throws(() => validateSize(1.5, 3));
});
