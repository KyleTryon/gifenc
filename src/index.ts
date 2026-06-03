export { GIFEncoder, default } from "./encoder.js";
export { default as quantize } from "./pnn-quant.js";
export {
  applyPalette,
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
  GIFEncoderInstance,
  GIFEncoderOptions,
  Int32Buffer,
  Palette,
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
