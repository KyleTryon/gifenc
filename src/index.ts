export { frameDelay } from "./timing.js";
export { encodeFrameChunk, assembleFrameChunks } from "./chunks.js";
export { GIFEncoder, default } from "./encoder.js";
export { default as quantize } from "./pnn-quant.js";
export {
  applyPalette,
  createPaletteMapper,
  createPaletteSampler,
  nearestColor,
  nearestColorIndex,
  nearestColorIndexWithDistance,
  prequantize,
  createTemporalDither,
  createTemporalDitherSequence,
  snapColorsToPalette,
} from "./palette/index.js";

export type {
  ApplyPaletteOptions,
  ByteArray,
  ByteStream,
  ClampedByteArray,
  Color,
  DitherAlgorithm,
  DistanceFn,
  Format,
  FrameChunk,
  FrameChunkOptions,
  GIFEncoderInstance,
  GIFEncoderOptions,
  Int32Buffer,
  Palette,
  PaletteMapper,
  PaletteMapperOptions,
  PaletteSampler,
  PrequantizeOptions,
  QuantizeOptions,
  RGBA,
  RGBAInput,
  RGB,
  TemporalDitherChangeDetectionOptions,
  TemporalDitherOptions,
  TemporalDitherSequence,
  TemporalDitherState,
  WriteFrameOptions,
} from "./types.js";
