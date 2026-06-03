/**
 * Color packing strategy used while reducing RGBA pixels into histogram bins.
 *
 * `rgb565` is the default and preserves more green precision, `rgb444` uses a
 * smaller 12-bit RGB histogram, and `rgba4444` preserves alpha in the palette.
 */
export type Format = "rgb565" | "rgb444" | "rgba4444";

/**
 * Error-diffusion algorithm available when mapping RGBA pixels to a palette.
 */
export type DitherAlgorithm = "floyd-steinberg";

/**
 * Byte buffer used for encoded GIF data and indexed frame pixels.
 */
export type ByteArray = Uint8Array;

/**
 * Browser canvas-compatible RGBA byte buffer.
 */
export type ClampedByteArray = Uint8ClampedArray;

/**
 * Internal signed 32-bit work buffer used by the encoder.
 */
export type Int32Buffer = Int32Array;

/**
 * Flat RGBA pixel data in `[r, g, b, a, ...]` order.
 *
 * The length must be divisible by 4.
 */
export type RGBAInput = ByteArray | ClampedByteArray;

/**
 * RGB color tuple with channels in the inclusive range `0..255`.
 */
export type RGB = [number, number, number];

/**
 * RGBA color tuple with channels in the inclusive range `0..255`.
 */
export type RGBA = [number, number, number, number];

/**
 * Palette color. RGB colors are opaque unless the calling API documents
 * format-specific alpha handling.
 */
export type Color = RGB | RGBA;

/**
 * GIF palette containing between 1 and 256 colors.
 */
export type Palette = Color[];

/**
 * Distance function used by nearest-color helpers.
 *
 * Return lower values for closer colors. Squared distances are fine because the
 * helpers only compare relative distance.
 */
export type DistanceFn = (
  colorA: readonly number[],
  colorB: readonly number[],
) => number;

/**
 * Options for {@link quantize}.
 */
export type QuantizeOptions = {
  /**
   * Histogram packing format. Defaults to `"rgb565"`.
   */
  format?: Format;
  /**
   * Quantize alpha to either fully transparent or fully opaque.
   *
   * `true` uses a threshold of `127`; a number uses that value as the
   * threshold.
   */
  oneBitAlpha?: boolean | number;
  /**
   * Replace pixels at or below {@link clearAlphaThreshold} before quantization.
   *
   * Defaults to `true`.
   */
  clearAlpha?: boolean;
  /**
   * Alpha threshold used when {@link clearAlpha} is enabled.
   *
   * Defaults to `0`.
   */
  clearAlphaThreshold?: number;
  /**
   * Channel value used to clear transparent RGB data before quantization.
   *
   * Defaults to `0x00`.
   */
  clearAlphaColor?: number;
  /**
   * Use square-root weighted bin counts while clustering.
   *
   * Defaults to `true`, but may be disabled automatically for very large
   * palettes.
   */
  useSqrt?: boolean;
};

/**
 * Options for {@link prequantize}.
 */
export type PrequantizeOptions = {
  /**
   * RGB rounding step. Higher values reduce detail before quantization.
   *
   * Defaults to `5`.
   */
  roundRGB?: number;
  /**
   * Alpha rounding step. Higher values reduce alpha detail before quantization.
   *
   * Defaults to `10`.
   */
  roundAlpha?: number;
  /**
   * Quantize alpha to either fully transparent or fully opaque.
   *
   * `true` uses a threshold of `127`; a number uses that value as the
   * threshold. Defaults to `null`, which preserves rounded alpha.
   */
  oneBitAlpha?: boolean | number | null;
};

/**
 * Options for {@link applyPalette}.
 */
export type ApplyPaletteOptions = {
  /**
   * Palette lookup format. Defaults to `"rgb565"`.
   */
  format?: Format;
  /**
   * Enable dithering while mapping pixels to palette indexes.
   *
   * `true` currently selects `"floyd-steinberg"`.
   */
  dither?: boolean | DitherAlgorithm;
  /**
   * Frame width in pixels. Required when dithering is enabled.
   */
  width?: number;
  /**
   * Frame height in pixels. Required when dithering is enabled.
   */
  height?: number;
  /**
   * Multiplier for dithered error diffusion.
   *
   * Defaults to `1`.
   */
  ditherStrength?: number;
  /**
   * Reverse every other dither row to reduce directional artifacts.
   *
   * Defaults to `false`.
   */
  serpentine?: boolean;
};

/**
 * Options for {@link GIFEncoder}.
 */
export type GIFEncoderOptions = {
  /**
   * Automatically write the GIF header and logical screen descriptor on the
   * first frame.
   *
   * Defaults to `true`. Set to `false` for manual stream control.
   */
  auto?: boolean;
  /**
   * Initial output buffer capacity in bytes.
   *
   * Defaults to `4096`; the buffer grows as needed.
   */
  initialCapacity?: number;
};

/**
 * Options for {@link GIFEncoderInstance.writeFrame}.
 */
export type WriteFrameOptions = {
  /**
   * Palette for the frame.
   *
   * In auto mode, the first frame must provide a global palette. Later frames
   * may provide a local palette or omit it to use the global palette.
   */
  palette?: Palette | null;
  /**
   * Marks this as the first frame when `GIFEncoder({ auto: false })` is used.
   */
  first?: boolean;
  /**
   * Enable transparent color handling for this frame.
   */
  transparent?: boolean;
  /**
   * Palette index to treat as transparent when {@link transparent} is enabled.
   *
   * Defaults to `0`.
   */
  transparentIndex?: number;
  /**
   * Frame delay in milliseconds.
   *
   * GIF stores delay in hundredths of a second, so values are rounded to the
   * nearest 10ms.
   */
  delay?: number;
  /**
   * Animation loop count.
   *
   * `0` loops forever, `-1` omits the Netscape loop extension, and positive
   * values request that many extra iterations.
   */
  repeat?: number;
  /**
   * GIF disposal method override in the range `0..7`.
   *
   * Negative values use the encoder default.
   */
  dispose?: number;
  /**
   * GIF color resolution field.
   *
   * Defaults to `8`.
   */
  colorDepth?: number;
};

/**
 * Growable byte writer used internally by {@link GIFEncoderInstance}.
 */
export type ByteStream = {
  /**
   * Underlying ArrayBuffer containing the encoded bytes.
   */
  readonly buffer: ArrayBufferLike;
  /**
   * Reset the stream length while keeping allocated capacity.
   */
  reset: () => void;
  /**
   * Return a view of the written bytes without copying.
   */
  bytesView: () => ByteArray;
  /**
   * Return a copy of the written bytes.
   */
  bytes: () => ByteArray;
  /**
   * Append one byte.
   */
  writeByte: (byte: number) => void;
  /**
   * Append bytes from an array-like source.
   */
  writeBytes: (
    data: ArrayLike<number>,
    offset?: number,
    byteLength?: number,
  ) => void;
  /**
   * Append bytes from a `Uint8Array` view.
   */
  writeBytesView: (
    data: ByteArray,
    offset?: number,
    byteLength?: number,
  ) => void;
};

/**
 * Stateful GIF encoder instance.
 */
export type GIFEncoderInstance = {
  /**
   * Clear encoded data and reset automatic first-frame tracking.
   */
  reset: () => void;
  /**
   * Write the GIF trailer byte. Call this after the final frame.
   */
  finish: () => void;
  /**
   * Return a copy of encoded GIF bytes.
   */
  bytes: () => ByteArray;
  /**
   * Return a view of encoded GIF bytes without copying.
   */
  bytesView: () => ByteArray;
  /**
   * Underlying output buffer. Use {@link bytes} or {@link bytesView} for the
   * written range.
   */
  readonly buffer: ArrayBufferLike;
  /**
   * Low-level byte stream used by the encoder.
   */
  readonly stream: ByteStream;
  /**
   * Write the GIF89a header manually.
   */
  writeHeader: () => void;
  /**
   * Encode one indexed frame.
   *
   * `index` must contain exactly `width * height` palette indexes.
   */
  writeFrame: (
    index: ByteArray,
    width: number,
    height: number,
    opts?: WriteFrameOptions,
  ) => void;
};
