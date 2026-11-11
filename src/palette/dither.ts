import { assertRgbaByteLength } from "../rgba.js";
import { createPaletteLookup } from "./lookup.js";
import {
  beginTemporalFrame,
  commitTemporalFrame,
  sourceDistanceSq,
  temporalDitherChannels,
} from "./temporal.js";
import { alpha, blue, byteAt, colorAt, green, red } from "./utils.js";
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
  if (palette.length === 0) {
    throw new Error(
      "applyPalette() expected a non-empty palette when dithering",
    );
  }

  const hasAlpha = format === "rgba4444";
  const channels = temporalDitherChannels(format);
  const nearest = createPaletteLookup(palette, hasAlpha);
  const temporal = temporalDither
    ? beginTemporalFrame(
        temporalDither,
        rgba,
        format,
        resolvedWidth,
        resolvedHeight,
        nearest,
        "applyPalette",
      )
    : null;
  const remap = temporal?.remap ?? null;

  // Snapshot palette channels so the hot loop avoids per-pixel array lookups
  // through nested color tuples.
  const paletteLength = palette.length;
  const reds = new Uint8Array(paletteLength);
  const greens = new Uint8Array(paletteLength);
  const blues = new Uint8Array(paletteLength);
  const alphas = new Uint8Array(paletteLength);
  for (let i = 0; i < paletteLength; i++) {
    const color = colorAt(palette, i);
    reds[i] = red(color);
    greens[i] = green(color);
    blues[i] = blue(color);
    alphas[i] = alpha(color);
  }

  const rowLength = resolvedWidth * channels;
  const pixels = opts.dither
    ? acquireScratch(rowLength * Math.min(2, resolvedHeight))
    : null;
  const index = new Uint8Array(length);

  const initializeRow = (target: Float32Array, y: number): void => {
    const rowOffset = (y % 2) * rowLength;
    for (let x = 0; x < resolvedWidth; x++) {
      const sourceOffset = (y * resolvedWidth + x) * 4;
      const scratchOffset = rowOffset + x * channels;
      target[scratchOffset] = byteAt(rgba, sourceOffset);
      target[scratchOffset + 1] = byteAt(rgba, sourceOffset + 1);
      target[scratchOffset + 2] = byteAt(rgba, sourceOffset + 2);
      if (hasAlpha) target[scratchOffset + 3] = byteAt(rgba, sourceOffset + 3);
    }
  };

  if (pixels) {
    initializeRow(pixels, 0);
    if (resolvedHeight > 1) initializeRow(pixels, 1);
  }

  for (let y = 0; y < resolvedHeight; y++) {
    const reverse = serpentine && y % 2 === 1;
    const xStart = reverse ? resolvedWidth - 1 : 0;
    const xEnd = reverse ? -1 : resolvedWidth;
    const step = reverse ? -1 : 1;
    const rowOffset = (y % 2) * rowLength;

    for (let x = xStart; x !== xEnd; x += step) {
      const idx = y * resolvedWidth + x;
      const scratchOffset = rowOffset + x * channels;
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (pixels) {
        r = clampByte(pixels[scratchOffset] ?? 0);
        g = clampByte(pixels[scratchOffset + 1] ?? 0);
        b = clampByte(pixels[scratchOffset + 2] ?? 0);
        a = hasAlpha ? clampByte(pixels[scratchOffset + 3] ?? 0xff) : 0xff;
      } else {
        r = byteAt(rgba, idx * 4);
        g = byteAt(rgba, idx * 4 + 1);
        b = byteAt(rgba, idx * 4 + 2);
        a = hasAlpha ? byteAt(rgba, idx * 4 + 3) : 0xff;
      }
      let paletteIndex = nearest(r, g, b, a);

      if (temporal) {
        // Temporal stabilization: keep the previous frame's color for static
        // pixels when it is nearly as close as the best match. Spatial
        // diffusion then absorbs the small extra error, so dither patterns
        // stop churning between frames without shifting local average color.
        if (
          remap &&
          (temporal.pixelThresholdSq === Infinity ||
            sourceDistanceSq(
              rgba,
              idx * 4,
              temporal.source,
              idx * channels,
              channels,
            ) <= temporal.pixelThresholdSq)
        ) {
          const previousIndex = remap[temporal.indexes[idx] ?? 0] ?? 0;
          if (previousIndex !== paletteIndex) {
            const best = colorDistanceSq(
              reds,
              greens,
              blues,
              alphas,
              paletteIndex,
              r,
              g,
              b,
              a,
              hasAlpha,
            );
            const previous = colorDistanceSq(
              reds,
              greens,
              blues,
              alphas,
              previousIndex,
              r,
              g,
              b,
              a,
              hasAlpha,
            );
            const separation = paletteDistanceSq(
              reds,
              greens,
              blues,
              alphas,
              paletteIndex,
              previousIndex,
              hasAlpha,
            );
            if (
              Math.sqrt(previous) - Math.sqrt(best) <=
              temporal.tolerance * Math.sqrt(separation)
            ) {
              paletteIndex = previousIndex;
            }
          }
        }
        temporal.indexes[idx] = paletteIndex;
      }

      index[idx] = paletteIndex;

      if (pixels) {
        diffuseError(
          pixels,
          channels,
          resolvedWidth,
          x,
          rowOffset,
          y + 1 < resolvedHeight ? rowLength - rowOffset : -1,
          reverse,
          ditherStrength,
          r - (reds[paletteIndex] ?? 0),
          g - (greens[paletteIndex] ?? 0),
          b - (blues[paletteIndex] ?? 0),
          hasAlpha ? a - (alphas[paletteIndex] ?? 0xff) : 0,
        );
      }
    }
    if (pixels && y + 2 < resolvedHeight) initializeRow(pixels, y + 2);
  }

  if (temporalDither) {
    commitTemporalFrame(
      temporalDither,
      rgba,
      palette,
      format,
      resolvedWidth,
      resolvedHeight,
      "applyPalette",
    );
  }

  return index;
}

function colorDistanceSq(
  reds: Uint8Array,
  greens: Uint8Array,
  blues: Uint8Array,
  alphas: Uint8Array,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
  hasAlpha: boolean,
): number {
  const dr = (reds[i] ?? 0) - r;
  const dg = (greens[i] ?? 0) - g;
  const db = (blues[i] ?? 0) - b;
  let distance = dr * dr + dg * dg + db * db;
  if (hasAlpha) {
    const da = (alphas[i] ?? 0xff) - a;
    distance += da * da;
  }
  return distance;
}

function paletteDistanceSq(
  reds: Uint8Array,
  greens: Uint8Array,
  blues: Uint8Array,
  alphas: Uint8Array,
  i: number,
  j: number,
  hasAlpha: boolean,
): number {
  return colorDistanceSq(
    reds,
    greens,
    blues,
    alphas,
    i,
    reds[j] ?? 0,
    greens[j] ?? 0,
    blues[j] ?? 0,
    alphas[j] ?? 0xff,
    hasAlpha,
  );
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
