export { GIFEncoder, default } from "./encoder.js";
export { default as quantize } from "./pnn-quant.js";
export {
  applyPalette,
  nearestColor,
  nearestColorIndex,
  nearestColorIndexWithDistance,
  prequantize,
  snapColorsToPalette,
} from "./palettize.js";

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
  WriteFrameOptions,
} from "./types.js";
