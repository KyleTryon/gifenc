import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as pngjs from "pngjs";
import { GIFEncoder, applyPalette, quantize } from "../../dist/gifenc.mjs";

const { PNG } = pngjs;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FORMATS = ["rgb444", "rgb565", "rgba4444"];
const CASES = [
  {
    name: "high-color",
    file: "../../test/fixtures/baboon.png",
    quantizeIterations: 8,
    applyIterations: 25,
    encodeIterations: 50,
  },
  {
    name: "low-color",
    file: "../../test/fixtures/007.png",
    quantizeIterations: 25,
    applyIterations: 50,
    encodeIterations: 100,
  },
  {
    name: "transparent",
    file: "../../test/fixtures/007-transparent.png",
    quantizeIterations: 25,
    applyIterations: 50,
    encodeIterations: 100,
  },
];

const overrideIterations = readPositiveIntEnv("GIFENC_BENCH_ITERATIONS");

for (const benchCase of CASES) {
  await runCase(benchCase);
}

async function runCase(benchCase) {
  const image = await readImage(path.resolve(__dirname, benchCase.file));
  console.log(
    `\n${benchCase.name} ${path.basename(benchCase.file)} ${image.width}x${
      image.height
    }`,
  );
  console.log(
    "format,stage,iterations,mean_ms,median_ms,min_ms,max_ms,output_bytes",
  );

  for (const format of FORMATS) {
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
