export type Format = "rgb565" | "rgb444" | "rgba4444";

export type DitherAlgorithm = "floyd-steinberg";

export type ByteArray = Uint8Array<ArrayBufferLike>;

export type ClampedByteArray = Uint8ClampedArray<ArrayBufferLike>;

export type Int32Buffer = Int32Array<ArrayBufferLike>;

export type RGBAInput = ByteArray | ClampedByteArray;

export type Color = number[];

export type Palette = Color[];

export type DistanceFn = (
  colorA: readonly number[],
  colorB: readonly number[],
) => number;

export type QuantizeOptions = {
  format?: Format;
  oneBitAlpha?: boolean | number;
  clearAlpha?: boolean;
  clearAlphaThreshold?: number;
  clearAlphaColor?: number;
  useSqrt?: boolean;
};

export type PrequantizeOptions = {
  roundRGB?: number;
  roundAlpha?: number;
  oneBitAlpha?: boolean | number | null;
};

export type ApplyPaletteOptions = {
  format?: Format;
  dither?: boolean | DitherAlgorithm;
  width?: number;
  height?: number;
  ditherStrength?: number;
  serpentine?: boolean;
};

export type GIFEncoderOptions = {
  auto?: boolean;
  initialCapacity?: number;
};

export type WriteFrameOptions = {
  palette?: Palette | null;
  first?: boolean;
  transparent?: boolean;
  transparentIndex?: number;
  delay?: number;
  repeat?: number;
  dispose?: number;
  colorDepth?: number;
};

export type ByteStream = {
  readonly buffer: ArrayBufferLike;
  reset: () => void;
  bytesView: () => ByteArray;
  bytes: () => ByteArray;
  writeByte: (byte: number) => void;
  writeBytes: (
    data: ArrayLike<number>,
    offset?: number,
    byteLength?: number,
  ) => void;
  writeBytesView: (
    data: ByteArray,
    offset?: number,
    byteLength?: number,
  ) => void;
};

export type GIFEncoderInstance = {
  reset: () => void;
  finish: () => void;
  bytes: () => ByteArray;
  bytesView: () => ByteArray;
  readonly buffer: ArrayBufferLike;
  readonly stream: ByteStream;
  writeHeader: () => void;
  writeFrame: (
    index: ByteArray,
    width: number,
    height: number,
    opts?: WriteFrameOptions,
  ) => void;
};
