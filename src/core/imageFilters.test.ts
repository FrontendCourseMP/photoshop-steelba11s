import { describe, expect, test } from "vitest";
import { applyImageFilter } from "./imageFilters";

const source3x3 = new Uint8ClampedArray([
  0, 0, 0, 255,
  10, 10, 10, 255,
  20, 20, 20, 255,
  30, 30, 30, 255,
  40, 40, 40, 255,
  50, 50, 50, 255,
  60, 60, 60, 255,
  70, 70, 70, 255,
  80, 80, 80, 255,
]);

describe("applyImageFilter", () => {
  test("applies identity kernel to selected RGB channels", async () => {
    const result = await applyImageFilter({
      sourceData: source3x3,
      width: 3,
      height: 3,
      kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      mode: "kernel",
      channels: ["r", "g", "b"],
      edgeHandling: "copy",
    });

    expect(Array.from(result)).toEqual(Array.from(source3x3));
  });

  test("uses black padding at image edges", async () => {
    const result = await applyImageFilter({
      sourceData: source3x3,
      width: 3,
      height: 3,
      kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      mode: "kernel",
      channels: ["r"],
      edgeHandling: "black",
    });

    expect(result[0]).toBe(9);
    expect(result[1]).toBe(0);
  });

  test("applies median filter to remove a channel spike", async () => {
    const noisy = new Uint8ClampedArray(source3x3);
    noisy[(1 * 3 + 1) * 4] = 255;

    const result = await applyImageFilter({
      sourceData: noisy,
      width: 3,
      height: 3,
      kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      mode: "median",
      channels: ["r"],
      edgeHandling: "copy",
    });

    expect(result[(1 * 3 + 1) * 4]).toBe(50);
    expect(result[(1 * 3 + 1) * 4 + 1]).toBe(40);
  });
});
