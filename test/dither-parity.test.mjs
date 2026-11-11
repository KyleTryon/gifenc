import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyPalette, createTemporalDither } from "../dist/gifenc.mjs";

// Golden digests were produced by the full-frame diffusion implementation.
for (const format of ["rgb565", "rgba4444"]) {
  test(`dither scanlines preserve full-frame output for ${format}`, () => {
    const hash = createHash("sha256");
    const palette = Array.from({ length: 32 }, (_, i) => [
      (i * 37) % 256,
      (i * 91) % 256,
      (i * 153) % 256,
      (i * 59) % 256,
    ]);
    for (const [width, height] of [
      [1, 1],
      [1, 7],
      [7, 1],
      [2, 3],
      [19, 12],
      [64, 37],
    ]) {
      for (const serpentine of [false, true]) {
        for (const dither of [false, true]) {
          for (const temporal of [false, true]) {
            if (!dither && !temporal) continue;
            const temporalDither = temporal
              ? createTemporalDither({
                  width,
                  height,
                  format,
                  strength: 0.73,
                  decay: 0.83,
                  maxError: 87,
                  changeDetection: {
                    pixelThreshold: 30,
                    sceneChangeRatio: 0.5,
                  },
                })
              : null;
            for (let n = 0; n < 8; n++) {
              if (n === 5) temporalDither?.reset();
              const frameNumber = n === 4 ? 100 : n;
              const frame = new Uint8Array(width * height * 4);
              for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                  const i = (y * width + x) * 4;
                  frame[i] = (x * 3 + y + frameNumber * 2) % 256;
                  frame[i + 1] = (x + y * 2 + frameNumber) % 256;
                  frame[i + 2] = (x * 2 + y * 3 + frameNumber) % 256;
                  frame[i + 3] = (x * 7 + y * 5 + frameNumber * 3) % 256;
                }
              }
              hash.update(
                applyPalette(frame, palette, {
                  width,
                  height,
                  format,
                  serpentine,
                  dither,
                  ditherStrength: 0.73,
                  temporalDither,
                }),
              );
            }
          }
        }
      }
    }
    assert.equal(
      hash.digest("hex"),
      format === "rgb565"
        ? "ec0489f822db9545286f54a0c62e35138c6945f833c7798946547ab18db6bd29"
        : "928f275177a35170b267cbcc03b45729e83ca17b7cf36df3bb7c6be392439c22",
    );
  });
}
