import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as pngjs from "pngjs";
import { GIFEncoder, applyPalette, quantize } from "../../dist/gifenc.mjs";
import {
  BENCH_FORMATS,
  BENCH_IMAGE_FIXTURES,
  BENCH_VIDEO_FIXTURES,
} from "../../fixtures/index.js";

const { PNG } = pngjs;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const overrideIterations = readPositiveIntEnv("GIFENC_BENCH_ITERATIONS");

await printVideoFixture(BENCH_VIDEO_FIXTURES.basketball);
for (const benchCase of BENCH_IMAGE_FIXTURES) {
  await runCase(benchCase);
}

async function runCase(benchCase) {
  const image = await readImage(resolveRepoPath(benchCase.repoPath));
  console.log(
    `\n${benchCase.id} ${path.basename(benchCase.repoPath)} ${image.width}x${
      image.height
    }`,
  );
  console.log(
    "format,stage,iterations,mean_ms,median_ms,min_ms,max_ms,output_bytes",
  );

  for (const format of BENCH_FORMATS) {
    const quantizeIterations =
      overrideIterations ?? benchCase.quantizeIterations;
    const applyIterations = overrideIterations ?? benchCase.applyIterations;
    const encodeIterations = overrideIterations ?? benchCase.encodeIterations;

    const quantized = measure(quantizeIterations, () =>
      quantize(image.data, 256, { format }),
    );
    const palette = quantized.value;
    printResult(format, "quantize", quantized, palette.length);

    const applied = measure(applyIterations, () =>
      applyPalette(image.data, palette, format),
    );
    const index = applied.value;
    printResult(format, "applyPalette", applied, index.byteLength);

    const encoded = measure(encodeIterations, () => {
      const encoder = GIFEncoder({ auto: false });
      encoder.writeHeader();
      encoder.writeFrame(index, image.width, image.height, {
        first: true,
        palette,
      });
      encoder.finish();
      return encoder.bytesView();
    });
    printResult(format, "encode", encoded, encoded.value.byteLength);
  }
}

async function printVideoFixture(fixture) {
  const info = await stat(resolveRepoPath(fixture.repoPath));
  console.log(
    `${fixture.id} ${path.basename(fixture.repoPath)} ${fixture.fps}fps ${info.size} bytes`,
  );
}

function resolveRepoPath(repoPath) {
  return path.resolve(repoRoot, repoPath);
}

function measure(iterations, fn) {
  const warmup = Math.min(3, Math.max(1, Math.floor(iterations / 5)));
  for (let i = 0; i < warmup; i++) fn();

  const samples = new Float64Array(iterations);
  let value;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    value = fn();
    samples[i] = performance.now() - start;
  }

  samples.sort();
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    total += samples[i] ?? 0;
  }

  return {
    value,
    iterations,
    mean: total / iterations,
    median: percentile(samples, 0.5),
    min: samples[0] ?? 0,
    max: samples[samples.length - 1] ?? 0,
  };
}

function printResult(format, stage, result, outputBytes) {
  console.log(
    [
      format,
      stage,
      result.iterations,
      formatMs(result.mean),
      formatMs(result.median),
      formatMs(result.min),
      formatMs(result.max),
      outputBytes,
    ].join(","),
  );
}

function percentile(sortedSamples, p) {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.floor((sortedSamples.length - 1) * p)),
  );
  return sortedSamples[index] ?? 0;
}

function formatMs(value) {
  return value.toFixed(3);
}

function readPositiveIntEnv(name) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

async function readImage(file) {
  const { data, width, height } = PNG.sync.read(await readFile(file));
  return { data, width, height };
}
