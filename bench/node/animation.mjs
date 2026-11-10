import { GIFEncoder, applyPalette, quantize } from "../../dist/gifenc.mjs";
import { GifReader } from "omggif";

const width = 160;
const height = 90;
const frames = 12;
const delay = 50;
const iterations = Number(process.env.GIFENC_ANIMATION_ITERATIONS ?? 3);
if (!Number.isInteger(iterations) || iterations < 1) {
  throw new Error("GIFENC_ANIMATION_ITERATIONS must be a positive integer");
}

// Fixed inputs keep comparisons independent of external media and licenses.
function makeFrame(kind, frame) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cut = kind === "scene-cut" && frame >= frames / 2;
      let r = cut ? 210 - y : Math.round((x / (width - 1)) * 255);
      let g = cut ? x : Math.round((y / (height - 1)) * 255);
      let b = cut ? 50 : 130;
      if (
        kind === "motion" &&
        x >= frame * 8 &&
        x < frame * 8 + 28 &&
        y > 25 &&
        y < 60
      ) {
        r = 240;
        g = 40;
        b = 35;
      }
      // Pixel glyphs approximate high-contrast subtitle edges without fonts.
      if (
        kind === "text" &&
        y >= 68 &&
        y < 80 &&
        x > 20 &&
        x < 140 &&
        (x + Math.floor(y / 3)) % 9 < 4
      ) {
        r = 255;
        g = 255;
        b = 255;
      }
      if (kind === "alpha") {
        // Composite a moving translucent overlay on an opaque gradient.
        const a =
          x >= frame * 6 && x < frame * 6 + 48 && y > 15 && y < 65 ? 0.45 : 0;
        r = Math.round(r * (1 - a) + 255 * a);
        g = Math.round(g * (1 - a));
        b = Math.round(b * (1 - a) + 255 * a);
      }
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

function run(input) {
  const times = { quantize: 0, map: 0, encode: 0 };
  const encoder = GIFEncoder();
  for (const pixels of input) {
    let start = performance.now();
    const palette = quantize(pixels, 256);
    times.quantize += performance.now() - start;
    start = performance.now();
    const index = applyPalette(pixels, palette);
    times.map += performance.now() - start;
    start = performance.now();
    encoder.writeFrame(index, width, height, { palette, delay });
    times.encode += performance.now() - start;
  }
  const start = performance.now();
  encoder.finish();
  const bytes = encoder.bytes();
  times.encode += performance.now() - start;
  return { times, bytes };
}

function quality(input, bytes) {
  const gif = new GifReader(bytes);
  if (gif.numFrames() !== frames) throw new Error("Unexpected frame count");
  let squared = 0;
  let temporalSquared = 0;
  let duration = 0;
  let previousError;
  for (let f = 0; f < frames; f++) {
    duration += gif.frameInfo(f).delay * 10;
    const decoded = new Uint8Array(width * height * 4);
    gif.decodeAndBlitFrameRGBA(f, decoded);
    const error = new Int16Array(width * height * 3);
    for (let p = 0; p < width * height; p++) {
      for (let c = 0; c < 3; c++) {
        const j = p * 3 + c;
        error[j] = decoded[p * 4 + c] - input[f][p * 4 + c];
        squared += error[j] ** 2;
        if (previousError)
          temporalSquared += (error[j] - previousError[j]) ** 2;
      }
    }
    previousError = error;
  }
  if (duration !== frames * delay) throw new Error("Unexpected GIF duration");
  return {
    duration_ms: duration,
    rgb_rmse: Math.sqrt(squared / (frames * width * height * 3)),
    temporal_error_rmse: Math.sqrt(
      temporalSquared / ((frames - 1) * width * height * 3),
    ),
  };
}

const results = [];
for (const kind of ["gradient", "motion", "scene-cut", "text", "alpha"]) {
  const input = Array.from({ length: frames }, (_, i) => makeFrame(kind, i));
  const rssBefore = process.memoryUsage().rss;
  const cold = run(input);
  const warm = Array.from({ length: iterations }, () => run(input));
  const samples = Object.fromEntries(
    Object.keys(cold.times).map((stage) => [
      stage,
      warm.map((sample) => sample.times[stage]).sort((a, b) => a - b)[
        Math.floor(iterations / 2)
      ],
    ]),
  );
  results.push({
    sequence: kind,
    cold_ms: cold.times,
    warm_median_ms: samples,
    output_bytes: cold.bytes.length,
    rss_delta_bytes: process.memoryUsage().rss - rssBefore,
    ...quality(input, cold.bytes),
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      width,
      height,
      frames,
      warm_iterations: iterations,
      results,
    },
    null,
    2,
  ),
);
