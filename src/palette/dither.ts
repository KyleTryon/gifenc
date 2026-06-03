import { assertRgbaByteLength } from "../rgba.js";
import { nearestColorIndexRGB, nearestColorIndexRGBA } from "./nearest.js";
import {
  commitTemporalDitherFrame,
  prepareTemporalDitherFrame,
  temporalDitherChannels,
} from "./temporal.js";
import { alpha, blue, byteAt, green, red } from "./utils.js";
import type { Palette, RGBAInput } from "../types.js";
import type { NormalizedApplyPaletteOptions } from "./options.js";

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
  const pixels = new Float32Array(length * channels);
  const temporalPixels = temporalErrors
    ? new Float32Array(length * channels)
    : null;
  const index = new Uint8Array(length);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += channels) {
    const temporalStrength = temporalDither?.strength ?? 0;
    const r =
      byteAt(rgba, i) +
      (temporalErrors ? (temporalErrors[j] ?? 0) * temporalStrength : 0);
    const g =
      byteAt(rgba, i + 1) +
      (temporalErrors ? (temporalErrors[j + 1] ?? 0) * temporalStrength : 0);
    const b =
      byteAt(rgba, i + 2) +
      (temporalErrors ? (temporalErrors[j + 2] ?? 0) * temporalStrength : 0);
    pixels[j] = r;
    pixels[j + 1] = g;
    pixels[j + 2] = b;
    if (temporalPixels) {
      temporalPixels[j] = r;
      temporalPixels[j + 1] = g;
      temporalPixels[j + 2] = b;
    }
    if (hasAlpha) {
      const a =
        byteAt(rgba, i + 3) +
        (temporalErrors ? (temporalErrors[j + 3] ?? 0) * temporalStrength : 0);
      pixels[j + 3] = a;
      if (temporalPixels) temporalPixels[j + 3] = a;
    }
  }

  for (let y = 0; y < resolvedHeight; y++) {
    const reverse = serpentine && y % 2 === 1;
    const xStart = reverse ? resolvedWidth - 1 : 0;
    const xEnd = reverse ? -1 : resolvedWidth;
    const step = reverse ? -1 : 1;

    for (let x = xStart; x !== xEnd; x += step) {
      const idx = y * resolvedWidth + x;
      const pixelOffset = idx * channels;
      const r = clampByte(pixels[pixelOffset] ?? 0);
      const g = clampByte(pixels[pixelOffset + 1] ?? 0);
      const b = clampByte(pixels[pixelOffset + 2] ?? 0);
      const a = hasAlpha ? clampByte(pixels[pixelOffset + 3] ?? 0xff) : 0xff;
      const paletteIndex = hasAlpha
        ? nearestColorIndexRGBA(r, g, b, a, palette)
        : nearestColorIndexRGB(r, g, b, palette);
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

      if (temporalDither && temporalErrors && temporalPixels) {
        const tr = clampByte(temporalPixels[pixelOffset] ?? 0);
        const tg = clampByte(temporalPixels[pixelOffset + 1] ?? 0);
        const tb = clampByte(temporalPixels[pixelOffset + 2] ?? 0);
        const ta = hasAlpha
          ? clampByte(temporalPixels[pixelOffset + 3] ?? 0xff)
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
          resolvedHeight,
          x,
          y,
          reverse,
          ditherStrength,
          er,
          eg,
          eb,
          ea,
        );
      }
    }
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
  height: number,
  x: number,
  y: number,
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
    height,
    x + direction,
    y,
    er,
    eg,
    eb,
    ea,
    (strength * 7) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    height,
    x - direction,
    y + 1,
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
    height,
    x,
    y + 1,
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
    height,
    x + direction,
    y + 1,
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
  height: number,
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
  amount: number,
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * channels;
  pixels[idx] = (pixels[idx] ?? 0) + er * amount;
  pixels[idx + 1] = (pixels[idx + 1] ?? 0) + eg * amount;
  pixels[idx + 2] = (pixels[idx + 2] ?? 0) + eb * amount;
  if (channels === 4) pixels[idx + 3] = (pixels[idx + 3] ?? 0) + ea * amount;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 0xff ? 0xff : Math.round(value);
}
