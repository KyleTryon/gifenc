import test from "node:test";
import assert from "node:assert/strict";
import { applyPalette, prequantize, quantize } from "../dist/gifenc.mjs";

test("prequantize clamps rounded channels without overflowing into neighbors", () => {
  for (const ArrayType of [Uint8Array, Uint8ClampedArray]) {
    const pixel = new ArrayType([255, 255, 255, 255]);
    prequantize(pixel);
    assert.deepEqual(Array.from(pixel), [255, 255, 255, 255]);
    prequantize(pixel, { roundRGB: 10 });
    assert.deepEqual(Array.from(pixel), [255, 255, 255, 255]);
  }
});

test("zero is a valid one-bit alpha threshold in both preprocessing APIs", () => {
  const pixels = new Uint8Array([0, 0, 0, 0, 16, 16, 16, 16]);
  const rounded = pixels.slice();
  prequantize(rounded, { roundRGB: 1, roundAlpha: 1, oneBitAlpha: 0 });
  assert.deepEqual(Array.from(rounded), [0, 0, 0, 0, 16, 16, 16, 255]);
  assert.deepEqual(
    quantize(pixels, 2, { format: "rgba4444", oneBitAlpha: 0 }),
    [
      [0, 0, 0, 0],
      [16, 16, 16, 255],
    ],
  );
});

test("RGB565 preserves six bits of green", () => {
  const pixels = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) pixels.set([0, i * 4, 0, 255], i * 4);
  const palette = quantize(pixels, 64, { format: "rgb565" });
  assert.equal(palette.length, 64);
  assert.deepEqual(
    palette.map((color) => color[1]).sort((a, b) => a - b),
    Array.from({ length: 64 }, (_, i) => i * 4),
  );
});

test("RGBA clustering merges nearby opaque colors instead of erasing transparency", () => {
  const pixels = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 16, 16, 16, 255]);
  assert.deepEqual(
    quantize(pixels, 2, { format: "rgba4444", oneBitAlpha: true }),
    [
      [0, 0, 0, 0],
      [8, 8, 8, 255],
    ],
  );
});

for (const format of ["rgb444", "rgb565", "rgba4444"]) {
  test(`${format} cache maps full source colors independently of pixel order`, () => {
    const palette =
      format === "rgba4444"
        ? [
            [0, 0, 0, 0],
            [0, 0, 0, 7],
          ]
        : [
            [0, 0, 0],
            [7, 0, 0],
          ];
    const colors =
      format === "rgba4444"
        ? [
            [0, 0, 0, 0],
            [0, 0, 0, 7],
          ]
        : [
            [0, 0, 0, 255],
            [7, 0, 0, 255],
          ];
    const forward = applyPalette(
      new Uint8Array(colors.flat()),
      palette,
      format,
    );
    const reverse = applyPalette(
      new Uint8Array(colors.toReversed().flat()),
      palette,
      format,
    );
    assert.deepEqual(Array.from(forward), [0, 1]);
    assert.deepEqual(Array.from(reverse), [1, 0]);
  });
}
