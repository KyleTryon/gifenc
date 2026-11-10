export { encodeFrameChunk, assembleFrameChunks } from "./chunks.js";
export { GIFEncoder, default } from "./encoder.js";
export { default as quantize } from "./pnn-quant.js";
export {
  applyPalette,
  createPaletteMapper,
  nearestColor,
  nearestColorIndex,
  nearestColorIndexWithDistance,
  prequantize,
  createTemporalDither,
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
  PrequantizeOptions,
  QuantizeOptions,
  RGBA,
  RGBAInput,
  RGB,
  TemporalDitherChangeDetectionOptions,
  TemporalDitherOptions,
  TemporalDitherState,
  WriteFrameOptions,
} from "./types.js";
