import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyPalette, createTemporalDither } from "../dist/gifenc.mjs";

// The rgb565 spatial digest was produced by the original full-frame diffusion
// implementation and must not change. The rgba4444 spatial digest differs from
// it only because fully transparent targets now map to the palette's
// transparent entry, and pixels mapped to a fully transparent entry diffuse
// only their alpha error, not invisible RGB. Temporal digests pin the
// temporal stabilization behavior, including scene changes and reset.
const GOLDEN = {
  rgb565: {
    spatial: "096b22d4a54e59ccbd9cfcfe1fa56c15650cb5f6f9d0d0a3262268e03ca503bf",
    temporal:
      "b217d41855de42593c8756117f37755e49153547d1ffdf22232e9eea8d791e6f",
  },
  rgba4444: {
    spatial: "7859d5ccc8fd7bbee639869c421fd09add75d97365ae94bbbd69077af086b932",
    temporal:
      "9e8959766fb0e748acc643100d286256ce3b436d473136150f634476601f0a44",
  },
};

for (const format of ["rgb565", "rgba4444"]) {
  test(`dither scanlines preserve golden output for ${format}`, () => {
    const hashes = {
      spatial: createHash("sha256"),
      temporal: createHash("sha256"),
    };
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
              hashes[temporal ? "temporal" : "spatial"].update(
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
    assert.deepEqual(
      {
        spatial: hashes.spatial.digest("hex"),
        temporal: hashes.temporal.digest("hex"),
      },
      GOLDEN[format],
    );
  });
}
