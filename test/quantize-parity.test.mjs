import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { quantize, applyPalette } from "../dist/gifenc.mjs";

// Captured from the corrected object-based quantizer at the recorded commit.
const reference = JSON.parse(
  readFileSync(
    new URL("./fixtures/quantize-reference.json", import.meta.url),
    "utf8",
  ),
);
let seed = reference.seed;
const pixels = Uint8Array.from({ length: reference.pixelCount * 4 }, () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed & 255;
});
const reversed = new Uint8Array(pixels.length);
for (let i = 0; i < reference.pixelCount; i++)
  reversed.set(
    pixels.subarray(i * 4, i * 4 + 4),
    (reference.pixelCount - i - 1) * 4,
  );

test("typed quantizer preserves reference palettes and indexes across 48 option combinations", () => {
  for (const { maxColors, options, hash } of reference.cases) {
    const palette = quantize(pixels, maxColors, options);
    const actual = createHash("sha256")
      .update(JSON.stringify(palette))
      .update(applyPalette(pixels, palette, options.format))
      .digest("hex");
    assert.equal(actual, hash, JSON.stringify({ maxColors, options }));
    assert.deepEqual(
      quantize(reversed, maxColors, options),
      palette,
      `pixel order: ${JSON.stringify({ maxColors, options })}`,
    );
  }
});

test("empty, single-color, and dense histogram boundaries remain valid", () => {
  for (const format of ["rgb444", "rgb565", "rgba4444"]) {
    assert.deepEqual(quantize(new Uint8Array(), 256, { format }), []);
    const rgba = new Uint8Array([16, 32, 48, 255]);
    assert.deepEqual(quantize(rgba, 1, { format }), [
      format === "rgba4444" ? [16, 32, 48, 255] : [16, 32, 48],
    ]);
  }
  // Every RGB444 bin is occupied, exercising in-place dense compaction.
  const dense = new Uint8Array(4096 * 4);
  for (let i = 0; i < 4096; i++)
    dense.set(
      [((i >> 8) & 15) * 16, ((i >> 4) & 15) * 16, (i & 15) * 16, 255],
      i * 4,
    );
  const palette = quantize(dense, 256, { format: "rgb444" });
  assert.equal(palette.length, 256);
  assert.ok(
    palette.every((color) =>
      color.every(
        (channel) =>
          Number.isInteger(channel) && channel >= 0 && channel <= 255,
      ),
    ),
  );
  const reverseDense = new Uint8Array(dense.length);
  for (let i = 0; i < 4096; i++)
    reverseDense.set(dense.subarray(i * 4, i * 4 + 4), (4095 - i) * 4);
  assert.deepEqual(quantize(reverseDense, 256, { format: "rgb444" }), palette);
});
