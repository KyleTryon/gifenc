import test from "node:test";
import assert from "node:assert/strict";
import { GIFEncoder, quantize, applyPalette } from "../dist/gifenc.mjs";

const rgba = new Uint8Array([
  255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 0, 255,
]);
const palette = quantize(rgba, 4);
const index = applyPalette(rgba, palette);

function createEncoder() {
  return GIFEncoder();
}

test("writeFrame produces a GIF89a stream with a trailer", () => {
  const gif = createEncoder();
  gif.writeFrame(index, 2, 2, { palette });
  gif.finish();

  const bytes = gif.bytesView();
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  assert.equal(header, "GIF89a");
  assert.equal(bytes[bytes.length - 1], 0x3b);
});

test("writeFrame rejects invalid dimensions and index lengths", () => {
  const gif = createEncoder();
  assert.throws(() => gif.writeFrame(index, 0, 2, { palette }), /dimensions/);
  assert.throws(
    () => gif.writeFrame(index, 2, 3, { palette }),
    /width \* height/,
  );
  assert.equal(gif.bytesView().length, 0);
});

test("a failed writeFrame leaves the encoder usable", () => {
  const gif = createEncoder();
  assert.throws(() => gif.writeFrame(index, 2, 2, { palette, delay: -1 }));

  gif.writeFrame(index, 2, 2, { palette });
  gif.finish();
  const bytes = gif.bytesView();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), "GIF89a");
  assert.equal(bytes[bytes.length - 1], 0x3b);
});

test("writeFrame validates colorDepth", () => {
  for (const colorDepth of [0, 9, 2.5, Number.NaN, "8"]) {
    const gif = createEncoder();
    assert.throws(
      () => gif.writeFrame(index, 2, 2, { palette, colorDepth }),
      /colorDepth/,
    );
  }
  const gif = createEncoder();
  gif.writeFrame(index, 2, 2, { palette, colorDepth: 8 });
  gif.finish();
});

test("writeFrame validates transparentIndex", () => {
  for (const transparentIndex of [256, 1000, 1.5, null]) {
    const gif = createEncoder();
    assert.throws(
      () =>
        gif.writeFrame(index, 2, 2, {
          palette,
          transparent: true,
          transparentIndex,
        }),
      /transparentIndex/,
    );
  }
});

test("writeFrame validates delay", () => {
  for (const delay of [-1, -100, Number.POSITIVE_INFINITY, "50"]) {
    const gif = createEncoder();
    assert.throws(
      () => gif.writeFrame(index, 2, 2, { palette, delay }),
      /delay/,
    );
  }
});

test("writeFrame rejects delays that overflow the 16-bit GIF field", () => {
  for (const delay of [655360, 1e9]) {
    const gif = createEncoder();
    assert.throws(
      () => gif.writeFrame(index, 2, 2, { palette, delay }),
      /delay/,
    );
  }
});

test("an invalid first palette leaves the stream empty and retryable", () => {
  const gif = createEncoder();
  assert.throws(
    () => gif.writeFrame(index, 2, 2, { palette: null }),
    /\{ palette \}/,
  );
  assert.equal(gif.bytesView().length, 0);

  const badPalette = [[256, 0, 0]];
  assert.throws(
    () => gif.writeFrame(index, 2, 2, { palette: badPalette }),
    /palette/,
  );
  assert.equal(gif.bytesView().length, 0);

  // The encoder must still emit a complete GIF with header, screen
  // descriptor, and global color table on the next attempt.
  gif.writeFrame(index, 2, 2, { palette });
  gif.finish();
  const bytes = gif.bytesView();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 6)), "GIF89a");
  // logical screen descriptor follows the 6-byte header
  assert.equal(bytes[6], 2); // width low byte
  assert.equal(bytes[10] & 0x80, 0x80); // global color table flag
});

test("an invalid later local palette appends nothing to the stream", () => {
  const gif = createEncoder();
  gif.writeFrame(index, 2, 2, { palette });
  const lengthAfterFirstFrame = gif.bytesView().length;

  const badPalette = [[0, 0, -1]];
  assert.throws(
    () => gif.writeFrame(index, 2, 2, { palette: badPalette }),
    /palette/,
  );
  assert.equal(gif.bytesView().length, lengthAfterFirstFrame);

  gif.writeFrame(index, 2, 2, { palette });
  gif.finish();
});

test("writeFrame validates repeat", () => {
  for (const repeat of [-2, 65536, 1.5, null]) {
    const gif = createEncoder();
    assert.throws(
      () => gif.writeFrame(index, 2, 2, { palette, repeat }),
      /repeat/,
    );
  }
});

test("writeFrame validates dispose", () => {
  for (const dispose of [8, 100, 0.5, null]) {
    const gif = createEncoder();
    assert.throws(
      () => gif.writeFrame(index, 2, 2, { palette, dispose }),
      /dispose/,
    );
  }
});

test("writeFrame accepts documented option ranges", () => {
  const gif = createEncoder();
  gif.writeFrame(index, 2, 2, {
    palette,
    repeat: 65535,
    dispose: 7,
    delay: 0,
    transparent: true,
    transparentIndex: 255,
  });
  gif.finish();
  assert.ok(gif.bytesView().length > 0);
});
