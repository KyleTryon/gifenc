import {
  assembleFrameChunks,
  encodeFrameChunk,
  type FrameChunk,
  type FrameChunkOptions,
} from "../../src/index.js";

const options: FrameChunkOptions = {
  sequenceIndex: 0,
  globalPalette: [[0, 0, 0]],
};
const chunk: FrameChunk = encodeFrameChunk(new Uint8Array([0]), 1, 1, options);
const bytes: Uint8Array = assembleFrameChunks([chunk], 1);
void bytes;
// @ts-expect-error shared palette context is required
encodeFrameChunk(new Uint8Array([0]), 1, 1, {
  sequenceIndex: 0,
});
// @ts-expect-error sequence index cannot be supplied as a string
encodeFrameChunk(new Uint8Array([0]), 1, 1, { ...options, sequenceIndex: "0" });

// @ts-expect-error final frame count is required for assembly
assembleFrameChunks([chunk]);
