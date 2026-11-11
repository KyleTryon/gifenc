import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPalette,
  createTemporalDither,
  createTemporalDitherSequence,
} from "../dist/gifenc.mjs";

const rgbPalette = [
  [0, 0, 0],
  [255, 255, 255],
];

const gray = (...values) =>
  new Uint8Array(values.flatMap((value) => [value, value, value, 255]));

// Gray 128 is nearer white. Gray 127 is nearer black by under 2 RGB units,
// within the default tolerance (12% of the 441-unit black/white separation).
// Gray 100 is nearer black by 95 units, beyond it.
const map = (frame, temporalDither, palette = rgbPalette) =>
  Array.from(applyPalette(frame, palette, { temporalDither }));

test("temporal dithering keeps a static pixel's previous color within tolerance", () => {
  const temporalDither = createTemporalDither({ width: 1, height: 1 });

  assert.deepEqual(map(gray(127), null), [0]);
  assert.deepEqual(map(gray(128), temporalDither), [1]);
  assert.deepEqual(map(gray(127), temporalDither), [1]);
  assert.deepEqual(map(gray(100), temporalDither), [0]);
});

test("temporal strength scales the tolerance", () => {
  const off = createTemporalDither({ width: 1, height: 1, strength: 0 });
  map(gray(128), off);
  assert.deepEqual(map(gray(127), off), [0]);

  const strong = createTemporalDither({
    width: 1,
    height: 1,
    strength: 10,
    changeDetection: false,
  });
  map(gray(128), strong);
  assert.deepEqual(map(gray(100), strong), [1]);
});

test("reset clears temporal history", () => {
  const temporalDither = createTemporalDither({ width: 1, height: 1 });

  map(gray(128), temporalDither);
  temporalDither.reset();

  assert.deepEqual(map(gray(127), temporalDither), [0]);
});

test("change detection releases pixels whose source changed", () => {
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    changeDetection: { pixelThreshold: 1 },
  });

  map(gray(128), temporalDither);

  assert.deepEqual(map(gray(127), temporalDither), [0]);
});

test("change detection drops all history after a scene change", () => {
  const options = {
    width: 2,
    height: 1,
    changeDetection: { pixelThreshold: 2, sceneChangeRatio: 0.5 },
  };
  const cut = createTemporalDither(options);
  const partial = createTemporalDither({
    ...options,
    changeDetection: { pixelThreshold: 2, sceneChangeRatio: 0.75 },
  });

  map(gray(128, 128), cut);
  map(gray(128, 128), partial);

  assert.deepEqual(map(gray(127, 60), cut), [0, 0]);
  assert.deepEqual(map(gray(127, 60), partial), [1, 0]);
});

test("disabled change detection still requires a close previous color", () => {
  const temporalDither = createTemporalDither({
    width: 1,
    height: 1,
    changeDetection: false,
  });

  map(gray(128), temporalDither);
  assert.deepEqual(map(gray(127), temporalDither), [1]);
  assert.deepEqual(map(gray(100), temporalDither), [0]);
});

test("temporal history follows colors across per-frame palettes", () => {
  const temporalDither = createTemporalDither({ width: 1, height: 1 });
  const first = [
    [0, 0, 0],
    [250, 250, 250],
  ];
  const reordered = [
    [251, 251, 251],
    [0, 0, 0],
  ];

  assert.deepEqual(map(gray(128), temporalDither, first), [1]);
  assert.deepEqual(map(gray(125), null, reordered), [1]);
  assert.deepEqual(map(gray(125), temporalDither, reordered), [0]);
});

test("temporal stabilization keeps Floyd-Steinberg patterns steady under noise", () => {
  const width = 48;
  const height = 32;
  const palette = Array.from({ length: 8 }, (_, i) => [i * 36, i * 36, i * 36]);
  let seed = 1;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const frames = Array.from({ length: 6 }, () => {
    const frame = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const value = Math.round((x / (width - 1)) * 250 + random() * 2);
        frame.fill(value, i, i + 3);
        frame[i + 3] = 255;
      }
    }
    return frame;
  });

  const changedPixels = (temporalDither) => {
    let previous;
    let changed = 0;
    for (const frame of frames) {
      const index = applyPalette(frame, palette, {
        width,
        height,
        dither: "floyd-steinberg",
        temporalDither,
      });
      if (previous) {
        for (let i = 0; i < index.length; i++) {
          if (index[i] !== previous[i]) changed++;
        }
      }
      previous = index;
    }
    return changed;
  };

  const spatialOnly = changedPixels(null);
  const stabilized = changedPixels(createTemporalDither({ width, height }));

  assert.ok(spatialOnly > 0);
  assert.ok(
    stabilized < spatialOnly / 2,
    `expected fewer changed pixels: ${stabilized} vs ${spatialOnly}`,
  );
});

test("temporal dithering validates frame dimensions", () => {
  const frame = gray(100, 100);
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
  const frame = gray(100);
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

test("temporal dithering rejects foreign state objects", () => {
  assert.throws(
    () =>
      applyPalette(gray(100), rgbPalette, {
        temporalDither: { width: 1, height: 1, reset() {} },
      }),
    /temporalDither from createTemporalDither/,
  );
});

test("sequence lifecycle isolates animations and resets scene history", () => {
  const sequence = createTemporalDitherSequence();
  const options = { width: 1, height: 1 };
  const step = (state, value) => map(gray(value), state)[0];
  assert.throws(() => sequence.reset(), /not been started/);
  const first = sequence.start(options);
  assert.equal(step(first, 128), 1);
  assert.equal(step(first, 127), 1);
  sequence.reset();
  assert.equal(step(first, 127), 0);
  const next = sequence.start(options);
  assert.equal(step(first, 127), 0);
  assert.equal(step(next, 128), 1);
  sequence.end();
  sequence.end();
  assert.equal(step(next, 127), 0);
  assert.throws(() => sequence.reset(), /not been started/);
  const otherSequence = createTemporalDitherSequence();
  const independent = otherSequence.start(options);
  const concurrent = sequence.start(options);
  assert.equal(step(independent, 128), 1);
  assert.equal(step(concurrent, 100), 0);
  assert.equal(step(independent, 127), 1);
  assert.equal(step(concurrent, 127), 0);
  const resized = sequence.start({
    ...options,
    width: 2,
    changeDetection: false,
  });
  assert.equal(resized.width, 2);
  assert.equal(resized.changeDetection, false);
  assert.throws(
    () => sequence.start({ ...options, width: 0 }),
    /positive integer/,
  );
  sequence.reset();
});
