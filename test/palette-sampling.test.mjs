import assert from "node:assert/strict";
import test from "node:test";
import { createPaletteSampler, quantize } from "../dist/gifenc.mjs";

function pixels(count, color) {
  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) data.set(color, i * 4);
  return data;
}

test("samples the complete frame instead of omitting its tail", () => {
  const frame = new Uint8Array(9999 * 4);
  frame.set(pixels(5000, [255, 0, 0, 255]));
  frame.set(pixels(4999, [0, 0, 255, 255]), 5000 * 4);
  const sampler = createPaletteSampler(120000, 5000);
  for (let i = 0; i < 24; i++) assert.equal(sampler.addFrame(frame), 5000);
  const palette = sampler.quantize(2);
  assert.ok(palette.some(([r, , b]) => r > 240 && b < 10));
  assert.ok(palette.some(([r, , b]) => b > 240 && r < 10));
});

test("varies positions within strata to avoid a fixed-stride pattern", () => {
  const frame = new Uint8Array(4000 * 4);
  for (let i = 0; i < 4000; i++)
    frame.set(i % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], i * 4);
  const sampler = createPaletteSampler(2000, 2000);
  sampler.addFrame(frame);
  const palette = sampler.quantize(2);
  assert.equal(palette.length, 2);
  assert.ok(palette.some(([r]) => r > 240));
  assert.ok(palette.some(([, , b]) => b > 240));
});

test("handles missing, empty, small and unaligned frames and quantize options", () => {
  const sampler = createPaletteSampler(3, 2);
  assert.equal(sampler.addFrame(null), 0);
  assert.equal(sampler.addFrame(undefined), 0);
  assert.equal(sampler.addFrame(new Uint8Array()), 0);
  assert.deepEqual(sampler.quantize(2), []);
  const data = new Uint8Array([99, 255, 0, 0, 128, 0, 0, 255, 255]).subarray(1);
  assert.equal(sampler.addFrame(data), 2);
  assert.deepEqual(
    sampler.quantize(2, { format: "rgba4444", clearAlpha: false }),
    quantize(new Uint8Array(data), 2, {
      format: "rgba4444",
      clearAlpha: false,
    }),
  );
  assert.equal(sampler.addFrame(pixels(2, [0, 255, 0, 255])), 1);
  assert.equal(sampler.addFrame(data), 0);
  assert.throws(() => sampler.addFrame(new Uint8Array(3)), /divide by 4/);
  assert.throws(() => sampler.quantize(0), /maxColors/);
  assert.throws(
    () => sampler.quantize(2, { format: "invalid" }),
    /unsupported/,
  );
});

test("sampling is deterministic and validates budgets", () => {
  for (const value of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(
      () => createPaletteSampler(value, 1),
      /positive safe integer/,
    );
    assert.throws(
      () => createPaletteSampler(1, value),
      /positive safe integer/,
    );
  }
  const frame = Uint8Array.from({ length: 4000 }, (_, i) => i % 251);
  const a = createPaletteSampler(100, 50);
  const b = createPaletteSampler(100, 50);
  for (let i = 0; i < 2; i++) {
    a.addFrame(frame);
    b.addFrame(frame);
  }
  assert.deepEqual(a.quantize(16), b.quantize(16));
});
