import { describe, expect, test } from "vitest";
import { resizeImageData, resizeImageDataRegion } from "./imageScale";

const source2x2 = new Uint8ClampedArray([
  0, 0, 0, 255,
  100, 100, 100, 255,
  200, 200, 200, 255,
  255, 255, 255, 255,
]);

describe("resizeImageData", () => {
  test("resizes with nearest neighbor interpolation", () => {
    const resized = resizeImageData(source2x2, 2, 2, 4, 4, "nearest");

    expect(Array.from(resized.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(resized.slice((1 * 4 + 1) * 4, (1 * 4 + 2) * 4))).toEqual([
      0, 0, 0, 255,
    ]);
    expect(Array.from(resized.slice((3 * 4 + 3) * 4, (3 * 4 + 4) * 4))).toEqual([
      255, 255, 255, 255,
    ]);
  });

  test("resizes with bilinear interpolation", () => {
    const resized = resizeImageData(source2x2, 2, 2, 3, 3, "bilinear");
    const centerOffset = (1 * 3 + 1) * 4;

    expect(Array.from(resized.slice(centerOffset, centerOffset + 4))).toEqual([
      139, 139, 139, 255,
    ]);
  });

  test("resizes a target region without rendering the full target", () => {
    const full = resizeImageData(source2x2, 2, 2, 4, 4, "nearest");
    const region = resizeImageDataRegion(source2x2, 2, 2, 4, 4, 2, 2, 2, 2, "nearest");

    expect(Array.from(region.slice(0, 4))).toEqual(
      Array.from(full.slice((2 * 4 + 2) * 4, (2 * 4 + 3) * 4))
    );
    expect(Array.from(region.slice((1 * 2 + 1) * 4, (1 * 2 + 2) * 4))).toEqual(
      Array.from(full.slice((3 * 4 + 3) * 4, (3 * 4 + 4) * 4))
    );
  });
});
