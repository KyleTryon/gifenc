import { assertRgbaByteLength } from "../rgba.js";
import { createPaletteLookup } from "./lookup.js";
import {
  commitTemporalDitherFrame,
  prepareTemporalDitherFrame,
  temporalDitherChannels,
} from "./temporal.js";
import { alpha, blue, byteAt, green, red } from "./utils.js";
import type { Palette, RGBAInput } from "../types.js";
import type { NormalizedApplyPaletteOptions } from "./options.js";

// Only the current and next scanlines can receive diffusion. Retain at most
// 64 MiB, and overwrite each row before it is reused.
const MAX_RETAINED_SCRATCH_BYTES = 64 * 1024 * 1024;
let diffusionScratch: Float32Array | null = null;

function acquireScratch(elements: number): Float32Array {
  if (diffusionScratch?.length === elements) return diffusionScratch;
  const next = new Float32Array(elements);
  diffusionScratch =
    next.byteLength <= MAX_RETAINED_SCRATCH_BYTES ? next : null;
  return next;
}

export function applyPaletteDither(
  rgba: RGBAInput,
  palette: Palette,
  opts: NormalizedApplyPaletteOptions,
): Uint8Array {
  const { format, width, height, ditherStrength, serpentine, temporalDither } =
    opts;
  assertRgbaByteLength(rgba, "applyPalette");
  const length = rgba.length / 4;
  if (length !== Math.floor(length)) {
    throw new Error("applyPalette() expected RGBA data length to divide by 4");
  }
  const resolvedWidth = width ?? temporalDither?.width;
  if (
    !resolvedWidth ||
    resolvedWidth < 1 ||
    resolvedWidth !== Math.floor(resolvedWidth)
  ) {
    throw new Error("applyPalette() requires { width } when dithering");
  }

  const resolvedHeight =
    height ?? temporalDither?.height ?? length / resolvedWidth;
  if (
    resolvedHeight < 1 ||
    resolvedHeight !== Math.floor(resolvedHeight) ||
    resolvedWidth * resolvedHeight !== length
  ) {
    throw new Error(
      "applyPalette() requires { width, height } to match RGBA data when dithering",
    );
  }

  const hasAlpha = format === "rgba4444";
  const channels = temporalDitherChannels(format);
  const nearest = createPaletteLookup(palette, hasAlpha);
  const temporalErrors = temporalDither
    ? prepareTemporalDitherFrame(
        temporalDither,
        rgba,
        format,
        resolvedWidth,
        resolvedHeight,
        "applyPalette",
      )
    : null;
  const rowLength = resolvedWidth * channels;
  const diffusionLength = rowLength * Math.min(2, resolvedHeight);
  const pixels = acquireScratch(diffusionLength * (temporalErrors ? 2 : 1));
  const index = new Uint8Array(length);
  const temporalStrength = temporalDither?.strength ?? 0;

  const initializeRow = (y: number): void => {
    const rowOffset = (y % 2) * rowLength;
    for (let x = 0; x < resolvedWidth; x++) {
      const sourceOffset = (y * resolvedWidth + x) * 4;
      const errorOffset = (y * resolvedWidth + x) * channels;
      const scratchOffset = rowOffset + x * channels;
      pixels[scratchOffset] =
        byteAt(rgba, sourceOffset) +
        (temporalErrors
          ? (temporalErrors[errorOffset] ?? 0) * temporalStrength
          : 0);
      pixels[scratchOffset + 1] =
        byteAt(rgba, sourceOffset + 1) +
        (temporalErrors
          ? (temporalErrors[errorOffset + 1] ?? 0) * temporalStrength
          : 0);
      pixels[scratchOffset + 2] =
        byteAt(rgba, sourceOffset + 2) +
        (temporalErrors
          ? (temporalErrors[errorOffset + 2] ?? 0) * temporalStrength
          : 0);
      if (hasAlpha)
        pixels[scratchOffset + 3] =
          byteAt(rgba, sourceOffset + 3) +
          (temporalErrors
            ? (temporalErrors[errorOffset + 3] ?? 0) * temporalStrength
            : 0);
    }
    if (temporalErrors) {
      pixels.copyWithin(
        diffusionLength + rowOffset,
        rowOffset,
        rowOffset + rowLength,
      );
    }
  };

  initializeRow(0);
  if (resolvedHeight > 1) initializeRow(1);

  for (let y = 0; y < resolvedHeight; y++) {
    const reverse = serpentine && y % 2 === 1;
    const xStart = reverse ? resolvedWidth - 1 : 0;
    const xEnd = reverse ? -1 : resolvedWidth;
    const step = reverse ? -1 : 1;
    const rowOffset = (y % 2) * rowLength;

    for (let x = xStart; x !== xEnd; x += step) {
      const idx = y * resolvedWidth + x;
      const pixelOffset = idx * channels;
      const scratchOffset = rowOffset + x * channels;
      const r = clampByte(pixels[scratchOffset] ?? 0);
      const g = clampByte(pixels[scratchOffset + 1] ?? 0);
      const b = clampByte(pixels[scratchOffset + 2] ?? 0);
      const a = hasAlpha ? clampByte(pixels[scratchOffset + 3] ?? 0xff) : 0xff;
      const paletteIndex = nearest(r, g, b, a);
      const color = palette[paletteIndex];
      if (!color) {
        throw new Error(
          "applyPalette() expected a non-empty palette when dithering",
        );
      }

      index[idx] = paletteIndex;
      const er = r - red(color);
      const eg = g - green(color);
      const eb = b - blue(color);
      const ea = hasAlpha ? a - alpha(color) : 0;

      if (temporalDither && temporalErrors) {
        // The initialized Float32 values exclude spatial diffusion, as required
        // for temporal history. Keep just two rows alongside the diffusion rows.
        const originalOffset = diffusionLength + scratchOffset;
        const tr = clampByte(pixels[originalOffset] ?? 0);
        const tg = clampByte(pixels[originalOffset + 1] ?? 0);
        const tb = clampByte(pixels[originalOffset + 2] ?? 0);
        const ta = hasAlpha
          ? clampByte(pixels[originalOffset + 3] ?? 0xff)
          : 0xff;
        storeTemporalError(
          temporalErrors,
          pixelOffset,
          temporalDither,
          channels,
          tr - red(color),
          tg - green(color),
          tb - blue(color),
          hasAlpha ? ta - alpha(color) : 0,
        );
      }

      if (opts.dither) {
        diffuseError(
          pixels,
          channels,
          resolvedWidth,
          x,
          rowOffset,
          y + 1 < resolvedHeight ? rowLength - rowOffset : -1,
          reverse,
          ditherStrength,
          er,
          eg,
          eb,
          ea,
        );
      }
    }
    if (y + 2 < resolvedHeight) initializeRow(y + 2);
  }

  if (temporalDither) {
    commitTemporalDitherFrame(
      temporalDither,
      rgba,
      format,
      resolvedWidth,
      resolvedHeight,
      "applyPalette",
    );
  }

  return index;
}

function storeTemporalError(
  errors: Float32Array,
  offset: number,
  state: NonNullable<NormalizedApplyPaletteOptions["temporalDither"]>,
  channels: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
): void {
  errors[offset] = clampError(er * state.decay, state.maxError);
  errors[offset + 1] = clampError(eg * state.decay, state.maxError);
  errors[offset + 2] = clampError(eb * state.decay, state.maxError);
  if (channels === 4) {
    errors[offset + 3] = clampError(ea * state.decay, state.maxError);
  }
}

function clampError(value: number, maxError: number): number {
  if (value < -maxError) return -maxError;
  if (value > maxError) return maxError;
  return value;
}

function diffuseError(
  pixels: Float32Array,
  channels: number,
  width: number,
  x: number,
  rowOffset: number,
  nextRowOffset: number,
  reverse: boolean,
  strength: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
): void {
  const direction = reverse ? -1 : 1;
  addError(
    pixels,
    channels,
    width,
    x + direction,
    rowOffset,
    er,
    eg,
    eb,
    ea,
    (strength * 7) / 16,
  );
  if (nextRowOffset < 0) return;
  addError(
    pixels,
    channels,
    width,
    x - direction,
    nextRowOffset,
    er,
    eg,
    eb,
    ea,
    (strength * 3) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    x,
    nextRowOffset,
    er,
    eg,
    eb,
    ea,
    (strength * 5) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    x + direction,
    nextRowOffset,
    er,
    eg,
    eb,
    ea,
    (strength * 1) / 16,
  );
}

function addError(
  pixels: Float32Array,
  channels: number,
  width: number,
  x: number,
  rowOffset: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
  amount: number,
): void {
  if (x < 0 || x >= width) return;
  const idx = rowOffset + x * channels;
  pixels[idx] = (pixels[idx] ?? 0) + er * amount;
  pixels[idx + 1] = (pixels[idx + 1] ?? 0) + eg * amount;
  pixels[idx + 2] = (pixels[idx + 2] ?? 0) + eb * amount;
  if (channels === 4) pixels[idx + 3] = (pixels[idx + 3] ?? 0) + ea * amount;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 0xff ? 0xff : Math.round(value);
}
