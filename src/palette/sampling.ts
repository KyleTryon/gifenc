import quantize from "../pnn-quant.js";
import { assertRgbaByteLength, assertRgbaInput } from "../rgba.js";
import type { PaletteSampler, RGBAInput } from "../types.js";

/**
 * Collect a bounded, deterministic sample from caller-selected RGBA frames.
 * Each frame is divided into equal strata, with a varying sample position in
 * each stratum to reduce fixed-stride aliasing. Missing or empty frames are
 * ignored. Once full, subsequent frames contribute no samples.
 *
 * The sample buffer uses exactly `maxSamples * 4` bytes. Callers should divide
 * their total budget among selected frames to give each frame a fair share.
 */
export function createPaletteSampler(
  maxSamples: number,
  samplesPerFrame: number,
): PaletteSampler {
  for (const [name, value] of [
    ["maxSamples", maxSamples],
    ["samplesPerFrame", samplesPerFrame],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `createPaletteSampler() expected ${name} to be a positive safe integer`,
      );
    }
  }
  const samples = new Uint8Array(maxSamples * 4);
  let count = 0;
  let frameNumber = 0;

  return {
    addFrame(rgba: RGBAInput | null | undefined): number {
      if (rgba == null) return 0;
      assertRgbaInput(rgba, "PaletteSampler.addFrame");
      assertRgbaByteLength(rgba, "PaletteSampler.addFrame");
      const pixels = rgba.length / 4;
      const amount = Math.min(pixels, samplesPerFrame, maxSamples - count);
      if (amount === 0) return 0;
      for (let i = 0; i < amount; i++) {
        const start = Math.floor((i * pixels) / amount);
        const end = Math.floor(((i + 1) * pixels) / amount);
        // Mix the frame and stratum indices, rather than sampling the same
        // offset in each repeated spatial pattern.
        let hash =
          Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(frameNumber + 1, 0x85ebca6b);
        hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
        hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
        hash = (hash ^ (hash >>> 16)) >>> 0;
        const source = (start + (hash % (end - start))) * 4;
        const target = (count + i) * 4;
        samples[target] = rgba[source] ?? 0;
        samples[target + 1] = rgba[source + 1] ?? 0;
        samples[target + 2] = rgba[source + 2] ?? 0;
        samples[target + 3] = rgba[source + 3] ?? 0;
      }
      count += amount;
      frameNumber++;
      return amount;
    },
    quantize(maxColors, options) {
      return quantize(samples.subarray(0, count * 4), maxColors, options);
    },
  };
}
