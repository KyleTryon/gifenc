import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { GifReader } from "omggif";
import { BENCH_FORMATS, BENCH_IMAGE_FIXTURES } from "../fixtures/index.js";

const [baselinePath, candidatePath, outputPath, stage = "all"] =
  process.argv.slice(2);
if (!baselinePath || !candidatePath || !outputPath) {
  throw new Error(
    "Usage: node scripts/review-performance.mjs baseline.mjs candidate.mjs output.json [all|mapping|quantize]",
  );
}
const baseline = await import(pathToFileURL(resolve(baselinePath)).href);
const candidate = await import(pathToFileURL(resolve(candidatePath)).href);
const rows = [];
for (const fixture of BENCH_IMAGE_FIXTURES) {
  const image = PNG.sync.read(await readFile(fixture.repoPath));
  for (const format of BENCH_FORMATS) {
    const palette = baseline.quantize(image.data, 256, { format });
    // Exact palette equality also preserves reconstruction error and alpha.
    assert.deepEqual(
      candidate.quantize(image.data, 256, { format }),
      palette,
      `${fixture.id}/${format}: palette changed`,
    );
    const index = baseline.applyPalette(image.data, palette, format);
    assert.deepEqual(
      candidate.applyPalette(image.data, palette, format),
      index,
      `${fixture.id}/${format}: indexes changed`,
    );
    const options = {
      format,
      dither: true,
      width: image.width,
      height: image.height,
    };
    assert.deepEqual(
      candidate.applyPalette(image.data, palette, options),
      baseline.applyPalette(image.data, palette, options),
      `${fixture.id}/${format}: dithering changed`,
    );
    const encode = (api) => {
      const encoder = api.GIFEncoder();
      encoder.writeFrame(index, image.width, image.height, { palette });
      encoder.finish();
      return encoder.bytesView();
    };
    assert.deepEqual(
      decodedGIF(encode(candidate)),
      decodedGIF(encode(baseline)),
      `${fixture.id}/${format}: decoded GIF changed`,
    );
    assert.deepEqual(
      decodedGIF(tinyEncode(candidate)),
      decodedGIF(tinyEncode(baseline)),
      `${fixture.id}/${format}: decoded tiny GIF changed`,
    );
    const operations =
      stage === "quantize"
        ? ["quantize"]
        : stage === "mapping"
          ? ["applyPalette", "reusedMapper"]
          : ["quantize", "applyPalette", "dither", "encode", "tinyEncode"];
    const mapper = candidate.createPaletteMapper?.(palette, format);
    if (mapper) {
      assert.deepEqual(
        mapper.map(image.data),
        index,
        `${fixture.id}/${format}: reusable indexes changed`,
      );
      mapper.reset();
    }
    if (stage === "mapping" && !mapper)
      throw new Error(
        "Mapping benchmarks require createPaletteMapper in the candidate bundle",
      );
    const actions = {
      quantize: [
        () => baseline.quantize(image.data, 256, { format }),
        () => candidate.quantize(image.data, 256, { format }),
      ],
      applyPalette: [
        () => baseline.applyPalette(image.data, palette, format),
        () => candidate.applyPalette(image.data, palette, format),
      ],
      dither: [
        () => baseline.applyPalette(image.data, palette, options),
        () => candidate.applyPalette(image.data, palette, options),
      ],
      reusedMapper: [
        () => baseline.applyPalette(image.data, palette, format),
        () => mapper.map(image.data),
      ],
      encode: [() => encode(baseline), () => encode(candidate)],
      tinyEncode: [() => tinyEncode(baseline), () => tinyEncode(candidate)],
    };
    for (const operation of operations) {
      const fns = actions[operation];
      for (let i = 0; i < 3; i++) {
        fns[0]();
        fns[1]();
      }
      const samples = [[], []];
      const iterations =
        operation === "quantize" ? 5 : operation === "tinyEncode" ? 100 : 15;
      for (let i = 0; i < iterations; i++) {
        for (const side of i % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          fns[side]();
          samples[side].push(performance.now() - start);
        }
      }
      const medians = samples.map(
        (values) =>
          values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)],
      );
      const row = {
        fixture: fixture.id,
        format,
        operation,
        baseline_ms: medians[0],
        candidate_ms: medians[1],
        speedup: medians[0] / medians[1],
      };
      rows.push(row);
      console.log(
        `${fixture.id} ${format} ${operation}: ${medians[0].toFixed(3)} -> ${medians[1].toFixed(3)} ms (${row.speedup.toFixed(2)}x)`,
      );
    }
  }
}
await writeFile(
  outputPath,
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      quality:
        "identical palettes, indexes, dithered indexes, and decoded GIF pixels and frame metadata for every fixture and format",
      rows,
    },
    null,
    2,
  ) + "\n",
);

function tinyEncode(api) {
  const encoder = api.GIFEncoder();
  encoder.writeFrame(new Uint8Array([0]), 1, 1, { palette: [[1, 2, 3]] });
  encoder.finish();
  return encoder.bytesView();
}

function decodedGIF(bytes) {
  const reader = new GifReader(bytes);
  const frames = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const {
      x,
      y,
      width,
      height,
      delay,
      disposal,
      transparent_index,
      interlaced,
    } = reader.frameInfo(i);
    const pixels = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(i, pixels);
    frames.push({
      x,
      y,
      width,
      height,
      delay,
      disposal,
      transparent_index,
      interlaced,
      pixels,
    });
  }
  return {
    width: reader.width,
    height: reader.height,
    loopCount: reader.loopCount(),
    frames,
  };
}
