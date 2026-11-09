import test from "node:test";
import assert from "node:assert/strict";
import { GifReader } from "omggif";
import { GIFEncoder, applyPalette, quantize } from "../dist/gifenc.mjs";

function decode(encoder, frame = 0) {
  const reader = new GifReader(encoder.bytes());
  const pixels = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(frame, pixels);
  return { reader, pixels };
}

test("LZW round-trips all 256 indexes across dictionary growth and resets", () => {
  const palette = Array.from({ length: 256 }, (_, i) => [i, 255 - i, i ^ 127]);
  let seed = 123456789;
  const index = Uint8Array.from({ length: 256 * 256 }, () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed & 255;
  });
  const gif = GIFEncoder({ initialCapacity: 1 });
  gif.writeFrame(index, 256, 256, { palette });
  gif.finish();
  assert.deepEqual(
    decode(gif).pixels,
    new Uint8Array(Array.from(index, (i) => [...palette[i], 255]).flat()),
  );
});

test("global and local palettes, delay, disposal, looping, and transparency decode correctly", () => {
  const gif = GIFEncoder();
  const global = [
    [255, 0, 0],
    [0, 255, 0],
  ];
  const local = [
    [0, 0, 255],
    [255, 255, 255],
  ];
  gif.writeFrame(new Uint8Array([0, 1]), 2, 1, {
    palette: global,
    colorDepth: 1,
    delay: 120,
    repeat: 3,
    dispose: 1,
  });
  gif.writeFrame(new Uint8Array([1, 0]), 2, 1, { colorDepth: 1 });
  gif.writeFrame(new Uint8Array([0, 1]), 2, 1, {
    palette: local,
    colorDepth: 1,
    transparent: true,
    transparentIndex: 1,
    dispose: 2,
  });
  gif.writeFrame(new Uint8Array([0, 1]), 2, 1, { colorDepth: 1 });
  gif.finish();
  const { reader, pixels } = decode(gif);
  assert.equal(reader.numFrames(), 4);
  assert.equal(reader.loopCount(), 3);
  assert.equal(reader.frameInfo(0).delay, 12);
  assert.equal(reader.frameInfo(0).disposal, 1);
  assert.deepEqual(Array.from(pixels), [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual(
    Array.from(decode(gif, 1).pixels),
    [0, 255, 0, 255, 255, 0, 0, 255],
  );
  assert.deepEqual(
    Array.from(decode(gif, 2).pixels),
    [0, 0, 255, 255, 0, 0, 0, 0],
  );
  assert.equal(reader.frameInfo(2).disposal, 2);
  assert.deepEqual(decode(gif, 3).pixels, pixels);
});

test("worker-style independently encoded chunks assemble into one decodable GIF", () => {
  const gif = GIFEncoder({ auto: false });
  gif.writeHeader();
  for (let frame = 0; frame < 3; frame++) {
    const chunk = GIFEncoder({ auto: false });
    chunk.writeFrame(new Uint8Array([0]), 1, 1, {
      palette: [[frame * 100, 0, 0]],
      first: frame === 0,
    });
    gif.stream.writeBytesView(chunk.bytesView());
  }
  gif.finish();
  assert.equal(decode(gif).reader.numFrames(), 3);
  for (let frame = 0; frame < 3; frame++)
    assert.deepEqual(Array.from(decode(gif, frame).pixels), [
      frame * 100,
      0,
      0,
      255,
    ]);
});

test("RGBA quantization and dithering preserve a transparent pixel through GIF encoding", () => {
  const rgba = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 16, 16, 16, 255]);
  const palette = quantize(rgba, 2, { format: "rgba4444", oneBitAlpha: true });
  const transparentIndex = palette.findIndex((color) => color[3] === 0);
  assert.ok(transparentIndex >= 0);
  const index = applyPalette(rgba, palette, {
    format: "rgba4444",
    dither: true,
    width: 3,
    height: 1,
  });
  const gif = GIFEncoder();
  gif.writeFrame(index, 3, 1, { palette, transparent: true, transparentIndex });
  gif.finish();
  const { pixels } = decode(gif);
  assert.deepEqual([pixels[3], pixels[7], pixels[11]], [0, 255, 255]);
});

test("maximum GIF width is preserved and reset clears palette and screen state", () => {
  const gif = GIFEncoder();
  gif.writeFrame(new Uint8Array(65535), 65535, 1, { palette: [[1, 2, 3]] });
  gif.finish();
  const { reader, pixels } = decode(gif);
  assert.equal(reader.width, 65535);
  assert.deepEqual(Array.from(pixels.subarray(-4)), [1, 2, 3, 255]);
  gif.reset();
  gif.writeFrame(new Uint8Array([0]), 1, 1, { palette: [[4, 5, 6]] });
  gif.finish();
  assert.deepEqual(Array.from(decode(gif).pixels), [4, 5, 6, 255]);
});
