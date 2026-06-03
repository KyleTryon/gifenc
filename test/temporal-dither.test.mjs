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

test("change detection clears residual across hard scene changes", () => {
  const firstFrame = new Uint8Array([100, 100, 100, 255]);
  const changedFrame = new Uint8Array([30, 30, 30, 255]);
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    decay: 1,
    maxError: 255,
  });

  applyPalette(firstFrame, rgbPalette, { temporalDither });
  const changedIndex = applyPalette(changedFrame, rgbPalette, {
    temporalDither,
  })[0];

  assert.equal(changedIndex, 0);
});

test("change detection clears only changed pixels below scene ratio", () => {
  const firstFrame = new Uint8Array([100, 100, 100, 255, 100, 100, 100, 255]);
  const partiallyChangedFrame = new Uint8Array([
    30, 30, 30, 255, 100, 100, 100, 255,
  ]);
  const temporalDither = createTemporalDither({
    width: 2,
    height: 1,
    decay: 1,
    maxError: 255,
  });

  applyPalette(firstFrame, rgbPalette, { temporalDither });
  const index = applyPalette(partiallyChangedFrame, rgbPalette, {
    temporalDither,
  });

  assert.deepEqual(Array.from(index), [0, 1]);
});

test("change detection can be disabled", () => {
  const firstFrame = new Uint8Array([100, 100, 100, 255]);
  const changedFrame = new Uint8Array([30, 30, 30, 255]);
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    decay: 1,
    maxError: 255,
    changeDetection: false,
  });

  applyPalette(firstFrame, rgbPalette, { temporalDither });
  const changedIndex = applyPalette(changedFrame, rgbPalette, {
    temporalDither,
  })[0];

  assert.equal(changedIndex, 1);
});

test("reset clears residual and starts a fresh change-detection history", () => {
  const firstFrame = new Uint8Array([100, 100, 100, 255]);
  const nextFrame = new Uint8Array([30, 30, 30, 255]);
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    decay: 1,
    maxError: 255,
  });

  applyPalette(firstFrame, rgbPalette, { temporalDither });
  temporalDither.reset();
  const afterReset = applyPalette(nextFrame, rgbPalette, { temporalDither })[0];

  assert.equal(afterReset, 0);
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

test("spatial diffusion is not stored in temporal history", () => {
  const frame = new Uint8Array([5, 5, 5, 255, 20, 20, 20, 255]);
  const temporalDither = createTemporalDither({
    width: 2,
    height: 1,
    decay: 1,
    maxError: 255,
    changeDetection: false,
  });
  const frames = [];

  for (let i = 0; i < 5; i++) {
    frames.push(
      Array.from(
        applyPalette(frame, rgbPalette, {
          dither: "floyd-steinberg",
          temporalDither,
        }),
      ),
    );
  }

  assert.deepEqual(frames, [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ]);
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
