import {
  rgb888_to_rgb444,
  rgb888_to_rgb565,
  rgba8888_to_rgba4444,
} from "../rgb-packing.js";
import { assertRgbaInput, createUint32PixelView } from "../rgba.js";
import { assertPalette, assertPaletteMatchesFormat } from "../validation.js";
import { applyPaletteDither } from "./dither.js";
import { normalizeApplyPaletteOptions } from "./options.js";
import { uint32At } from "./utils.js";
import type {
  ApplyPaletteOptions,
  Format,
  Palette,
  RGBAInput,
} from "../types.js";

/**
 * Map RGBA pixels to palette indexes.
 *
 * The returned `Uint8Array` contains one palette index per source pixel and can
 * be passed directly to {@link GIFEncoderInstance.writeFrame}. The input RGBA
 * array is not modified unless dithering is enabled, in which case error
 * diffusion works on a copied work buffer.
 *
 * @param rgba - Flat RGBA pixel data in `[r, g, b, a, ...]` order.
 * @param palette - Palette containing 1 to 256 RGB or RGBA colors.
 * @param options - Palette format string or detailed mapping options.
 * @returns Indexed pixels with length `rgba.length / 4`.
 */
export function applyPalette(
  rgba: RGBAInput,
  palette: Palette,
  options: Format | ApplyPaletteOptions | null = "rgb565",
): Uint8Array {
  assertRgbaInput(rgba, "applyPalette");

  const opts = normalizeApplyPaletteOptions(options);
  assertPalette(palette, "applyPalette");
  assertPaletteMatchesFormat(palette, opts.format, "applyPalette");
  const { format } = opts;
  if (opts.dither || opts.temporalDither) {
    return applyPaletteDither(rgba, palette, opts);
  }

  const data = createUint32PixelView(rgba, "applyPalette");
  const length = data.length;
  const bincount = format === "rgb444" ? 4096 : 65536;
  const index = new Uint8Array(length);
  const cache = new Int16Array(bincount);
  cache.fill(-1);
  const paletteLength = palette.length;
  const paletteR = new Uint8Array(paletteLength);
  const paletteG = new Uint8Array(paletteLength);
  const paletteB = new Uint8Array(paletteLength);
  const paletteA = new Uint8Array(paletteLength);
  for (let i = 0; i < paletteLength; i++) {
    const color = palette[i];
    if (!color) {
      throw new Error(
        `applyPalette() expected palette color at index ${String(i)}`,
      );
    }
    paletteR[i] = color[0];
    paletteG[i] = color[1];
    paletteB[i] = color[2];
    paletteA[i] = color[3] ?? 0xff;
  }

  // Some duplicate code below due to very hot code path.
  // Introducing branching/conditions shows significant impact.
  if (format === "rgba4444") {
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const a = (color >> 24) & 0xff;
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = rgba8888_to_rgba4444(r, g, b, a);
      let idx = cache[key] ?? -1;
      if (idx < 0) {
        idx = nearestColorIndexRGBAChannels(
          r,
          g,
          b,
          a,
          paletteR,
          paletteG,
          paletteB,
          paletteA,
          paletteLength,
        );
        cache[key] = idx;
      }
      index[i] = idx;
    }
  } else {
    const rgb888_to_key =
      format === "rgb444" ? rgb888_to_rgb444 : rgb888_to_rgb565;
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = rgb888_to_key(r, g, b);
      let idx = cache[key] ?? -1;
      if (idx < 0) {
        idx = nearestColorIndexRGBChannels(
          r,
          g,
          b,
          paletteR,
          paletteG,
          paletteB,
          paletteLength,
        );
        cache[key] = idx;
      }
      index[i] = idx;
    }
  }

  return index;
}

function nearestColorIndexRGBChannels(
  r: number,
  g: number,
  b: number,
  paletteR: Uint8Array,
  paletteG: Uint8Array,
  paletteB: Uint8Array,
  paletteLength: number,
): number {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < paletteLength; i++) {
    const dr = (paletteR[i] ?? 0) - r;
    let curdist = dr * dr;
    if (curdist > mindist) continue;
    const dg = (paletteG[i] ?? 0) - g;
    curdist += dg * dg;
    if (curdist > mindist) continue;
    const db = (paletteB[i] ?? 0) - b;
    curdist += db * db;
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}

function nearestColorIndexRGBAChannels(
  r: number,
  g: number,
  b: number,
  a: number,
  paletteR: Uint8Array,
  paletteG: Uint8Array,
  paletteB: Uint8Array,
  paletteA: Uint8Array,
  paletteLength: number,
): number {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < paletteLength; i++) {
    const da = (paletteA[i] ?? 0xff) - a;
    let curdist = da * da;
    if (curdist > mindist) continue;
    const dr = (paletteR[i] ?? 0) - r;
    curdist += dr * dr;
    if (curdist > mindist) continue;
    const dg = (paletteG[i] ?? 0) - g;
    curdist += dg * dg;
    if (curdist > mindist) continue;
    const db = (paletteB[i] ?? 0) - b;
    curdist += db * db;
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}
