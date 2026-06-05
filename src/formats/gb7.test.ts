import { describe, expect, test } from "vitest";
import { decodeGB7 } from "./gb7Decoder";
import { encodeGB7 } from "./gb7Encoder";

describe("GB7 format", () => {
  test("encodes and decodes grayscale pixels with mask", () => {
    const source = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);

    const encoded = encodeGB7({
      width: 2,
      height: 1,
      hasMask: true,
      data: source,
    });
    const decoded = decodeGB7(encoded);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(decoded.colorDepth).toBe(8);
    expect(Array.from(decoded.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]);
  });

  test("rejects truncated files before reading the header", () => {
    expect(() => decodeGB7(new ArrayBuffer(4))).toThrow(
      "Файл слишком маленький для GB7"
    );
  });

  test("rejects files whose payload length does not match dimensions", () => {
    const encoded = encodeGB7({
      width: 2,
      height: 1,
      hasMask: false,
      data: new Uint8ClampedArray(8),
    });

    expect(() => decodeGB7(encoded.slice(0, encoded.byteLength - 1))).toThrow(
      "Размер файла не совпадает с width * height"
    );
  });

  test("rejects image data that is too small for declared dimensions", () => {
    expect(() =>
      encodeGB7({
        width: 2,
        height: 2,
        hasMask: false,
        data: new Uint8ClampedArray(4),
      })
    ).toThrow("Недостаточно пиксельных данных для GB7");
  });
});
