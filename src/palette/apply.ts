import { assertRgbaInput, createUint32PixelView } from "../rgba.js";
import { assertPalette, assertPaletteMatchesFormat } from "../validation.js";
import { applyPaletteDither } from "./dither.js";
import { nearestColorIndexRGB, nearestColorIndexRGBA } from "./nearest.js";
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
  const index = new Uint8Array(length);
  // Cache complete source colors so collisions cannot make a pixel's mapping
  // depend on the order in which other pixels were encountered.
  const cache = new Map<number, number>();

  // Some duplicate code below due to very hot code path.
  // Introducing branching/conditions shows significant impact.
  if (format === "rgba4444") {
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const a = (color >> 24) & 0xff;
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = color;
      let idx = cache.get(key);
      if (idx == null) {
        idx = nearestColorIndexRGBA(r, g, b, a, palette);
        cache.set(key, idx);
      }
      index[i] = idx;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = color & 0xffffff;
      let idx = cache.get(key);
      if (idx == null) {
        idx = nearestColorIndexRGB(r, g, b, palette);
        cache.set(key, idx);
      }
      index[i] = idx;
    }
  }

  return index;
}
