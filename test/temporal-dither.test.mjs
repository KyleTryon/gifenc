import test from "node:test";
import assert from "node:assert/strict";
import { applyPalette, createTemporalDither } from "../dist/gifenc.mjs";

const rgbPalette = [
  [0, 0, 0],
  [255, 255, 255],
];

test("temporal dithering carries residual error and reset clears it", () => {
  const frame = new Uint8Array([100, 100, 100, 255]);
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    decay: 1,
    maxError: 255,
  });

  const sequence = [0, 1, 2].map(
    () => applyPalette(frame, rgbPalette, { temporalDither })[0],
  );
  temporalDither.reset();
  const resetIndex = applyPalette(frame, rgbPalette, { temporalDither })[0];

  assert.deepEqual(sequence, [0, 1, 0]);
  assert.equal(resetIndex, 0);
});

test("temporal dithering composes with Floyd-Steinberg dithering", () => {
  const frame = new Uint8Array([100, 100, 100, 255, 150, 150, 150, 255]);
  const temporalDither = createTemporalDither({
    width: 2,
    height: 1,
    decay: 1,
  });

  const index = applyPalette(frame, rgbPalette, {
    dither: "floyd-steinberg",
    temporalDither,
  });

  assert.equal(index.length, 2);
});

test("temporal dithering validates frame dimensions", () => {
  const frame = new Uint8Array([100, 100, 100, 255, 100, 100, 100, 255]);
  const temporalDither = createTemporalDither({
    width: 1,
    height: 2,
  });

  assert.throws(
    () =>
      applyPalette(frame, rgbPalette, {
        width: 2,
        height: 1,
        temporalDither,
      }),
    /temporalDither dimensions to match the frame/,
  );
});

test("temporal dithering validates alpha handling", () => {
  const frame = new Uint8Array([100, 100, 100, 255]);
  const rgbaPalette = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ];
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    format: "rgb565",
  });

  assert.throws(
    () =>
      applyPalette(frame, rgbaPalette, {
        format: "rgba4444",
        temporalDither,
      }),
    /temporalDither format to match alpha handling/,
  );
});
