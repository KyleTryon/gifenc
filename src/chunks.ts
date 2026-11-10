import { createEncoder, GIFEncoder } from "./encoder.js";
import { assertPalette } from "./validation.js";
import type {
  ByteArray,
  FrameChunk,
  FrameChunkOptions,
  Palette,
} from "./types.js";

/** Encode one transferable frame chunk. The first frame uses the global palette;
 * subsequent frames use it unless a local `palette` is supplied. */
export function encodeFrameChunk(
  index: ByteArray,
  width: number,
  height: number,
  options: FrameChunkOptions,
): FrameChunk {
  const { sequenceIndex, globalPalette, ...frameOptions } = options;
  if (!Number.isSafeInteger(sequenceIndex) || sequenceIndex < 0) {
    throw new Error(
      "encodeFrameChunk() expected a nonnegative integer sequenceIndex",
    );
  }
  assertPalette(globalPalette, "encodeFrameChunk");
  if (sequenceIndex === 0 && frameOptions.palette != null) {
    throw new Error("encodeFrameChunk() first frame must use globalPalette");
  }
  const encoder = createEncoder({ auto: false }, globalPalette.length);
  encoder.writeFrame(index, width, height, {
    ...frameOptions,
    first: sequenceIndex === 0,
    palette:
      sequenceIndex === 0 ? globalPalette : (frameOptions.palette ?? null),
  });
  return {
    sequenceIndex,
    width,
    height,
    globalPalette: globalPalette.map((color) => [...color] as typeof color),
    bytes: encoder.bytes(),
  };
}

function samePalette(a: Palette, b: Palette): boolean {
  return (
    a.length === b.length &&
    a.every(
      (color, i) =>
        color.length === b[i]?.length &&
        color.every((channel, j) => channel === b[i]?.[j]),
    )
  );
}

/** Validate and assemble a complete, possibly unordered set of frame chunks. */
export function assembleFrameChunks(
  chunks: readonly FrameChunk[],
  expectedFrames: number,
): ByteArray {
  if (
    !Number.isSafeInteger(expectedFrames) ||
    expectedFrames < 1 ||
    chunks.length !== expectedFrames
  ) {
    throw new Error("assembleFrameChunks() expected a complete set of chunks");
  }
  const ordered: (FrameChunk | undefined)[] = Array.from({
    length: chunks.length,
  });
  for (const chunk of chunks) {
    if (
      !Number.isSafeInteger(chunk.sequenceIndex) ||
      chunk.sequenceIndex < 0 ||
      chunk.sequenceIndex >= chunks.length ||
      ordered[chunk.sequenceIndex] ||
      !(chunk.bytes instanceof Uint8Array) ||
      chunk.bytes.length === 0
    ) {
      throw new Error(
        "assembleFrameChunks() expected one chunk for each sequence index",
      );
    }
    assertPalette(chunk.globalPalette, "assembleFrameChunks");
    ordered[chunk.sequenceIndex] = chunk;
  }
  const first = ordered[0];
  if (!first) throw new Error("assembleFrameChunks() missing first chunk");
  for (const chunk of ordered) {
    if (
      !chunk ||
      !Number.isInteger(chunk.width) ||
      !Number.isInteger(chunk.height) ||
      chunk.width < 1 ||
      chunk.height < 1 ||
      chunk.width > first.width ||
      chunk.height > first.height ||
      !samePalette(chunk.globalPalette, first.globalPalette)
    ) {
      throw new Error("assembleFrameChunks() inconsistent chunk context");
    }
  }
  const encoder = GIFEncoder({ auto: false });
  encoder.writeHeader();
  for (const chunk of ordered) {
    if (!chunk) throw new Error("assembleFrameChunks() missing chunk");
    encoder.stream.writeBytesView(chunk.bytes);
  }
  encoder.finish();
  return encoder.bytes();
}
