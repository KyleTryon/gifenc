import test from "node:test";
import assert from "node:assert/strict";
import { GifReader } from "omggif";
import {
  GIFEncoder,
  encodeFrameChunk,
  assembleFrameChunks,
} from "../dist/gifenc.mjs";

const globalPalette = [
  [255, 0, 0],
  [0, 255, 0],
];
const local = [
  [0, 0, 255],
  [255, 255, 255],
];
const frames = [
  { pixels: [0, 1], options: { delay: 120, repeat: 3, colorDepth: 1 } },
  { pixels: [1, 0], options: { colorDepth: 1 } },
  {
    pixels: [0, 1],
    options: {
      palette: local,
      colorDepth: 1,
      transparent: true,
      transparentIndex: 1,
    },
  },
  { pixels: [0, 1], options: { colorDepth: 1 } },
];
function makeChunks() {
  return frames.map(({ pixels, options }, sequenceIndex) =>
    encodeFrameChunk(Uint8Array.from(pixels), 2, 1, {
      ...options,
      sequenceIndex,
      totalFrames: frames.length,
      globalPalette,
    }),
  );
}

test("unordered independent chunks match sequential global and local palette frames", () => {
  const sequential = GIFEncoder();
  frames.forEach(({ pixels, options }, i) =>
    sequential.writeFrame(
      Uint8Array.from(pixels),
      2,
      1,
      i === 0 ? { ...options, palette: globalPalette } : options,
    ),
  );
  sequential.finish();
  const chunks = makeChunks();
  const bytes = assembleFrameChunks([
    chunks[2],
    chunks[0],
    chunks[3],
    chunks[1],
  ]);
  assert.deepEqual(bytes, sequential.bytes());
  const reader = new GifReader(bytes);
  assert.equal(reader.numFrames(), 4);
  assert.equal(reader.loopCount(), 3);
  const decoded = new Uint8Array(8);
  reader.decodeAndBlitFrameRGBA(2, decoded);
  assert.deepEqual(Array.from(decoded), [0, 0, 255, 255, 0, 0, 0, 0]);
});

test("rejects missing, duplicate and inconsistent chunks and invalid palette indexes", () => {
  const chunks = makeChunks();
  assert.throws(() => assembleFrameChunks(chunks.slice(0, 3)));
  assert.throws(() =>
    assembleFrameChunks([chunks[0], chunks[1], chunks[1], chunks[3]]),
  );
  assert.throws(() =>
    assembleFrameChunks([
      chunks[0],
      { ...chunks[1], globalPalette: local },
      chunks[2],
      chunks[3],
    ]),
  );
  assert.throws(() =>
    assembleFrameChunks([
      chunks[0],
      { ...chunks[1], width: 3 },
      chunks[2],
      chunks[3],
    ]),
  );
  assert.throws(() =>
    encodeFrameChunk(Uint8Array.of(2), 1, 1, {
      sequenceIndex: 1,
      totalFrames: 2,
      globalPalette,
    }),
  );
  assert.throws(() =>
    encodeFrameChunk(Uint8Array.of(0), 1, 1, {
      sequenceIndex: 1,
      totalFrames: 2,
      globalPalette,
      transparent: true,
      transparentIndex: 2,
    }),
  );
});
