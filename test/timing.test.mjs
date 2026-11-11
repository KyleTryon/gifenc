import test from "node:test";
import assert from "node:assert/strict";
import { GifReader } from "omggif";
import { GIFEncoder, frameDelay } from "../dist/gifenc.mjs";

function encodeIntervals(boundaries) {
  const gif = GIFEncoder();
  for (let i = 0; i < boundaries.length - 1; i++) {
    gif.writeFrame(new Uint8Array([0]), 1, 1, {
      palette: i === 0 ? [[0, 0, 0]] : undefined,
      delay: frameDelay(boundaries[i], boundaries[i + 1]),
    });
  }
  gif.finish();
  const reader = new GifReader(gif.bytes());
  return Array.from(
    { length: reader.numFrames() },
    (_, i) => reader.frameInfo(i).delay * 10,
  );
}

test("fractional frame rates preserve decoded cumulative timing", () => {
  for (const fps of [10, 12, 18, 30000 / 1001]) {
    const count = Math.ceil(15 * fps);
    const boundaries = Array.from({ length: count + 1 }, (_, i) =>
      Math.min((i * 1000) / fps, 15000),
    );
    const delays = encodeIntervals(boundaries);
    let total = 0;
    for (let i = 0; i < delays.length; i++) {
      total += delays[i];
      assert.equal(total, Math.round(boundaries[i + 1] / 10) * 10);
    }
    assert.equal(total, 15000);
  }
});

test("partial, skipped and sub-centisecond intervals follow boundaries", () => {
  assert.deepEqual(
    encodeIntervals([0, 83.333, 250, 255, 257]),
    [80, 170, 10, 0],
  );
  assert.equal(frameDelay(0, 655350), 655350);
  assert.equal(frameDelay(5, 655354), 655340);
  assert.throws(() => frameDelay(4, 655358), /delay/);
  assert.throws(() => frameDelay(0, 655355), /delay/);
  for (const [start, end] of [
    [-1, 0],
    [1, 0],
    [0, Infinity],
    [NaN, 1],
    [0, Number.MAX_VALUE],
  ]) {
    assert.throws(() => frameDelay(start, end));
  }
});
