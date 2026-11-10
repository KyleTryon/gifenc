import { assertRgbaInput, createUint32PixelView } from "../rgba.js";
import { assertPalette, assertPaletteMatchesFormat } from "../validation.js";
import { applyPaletteDither } from "./dither.js";
import { createPaletteLookup } from "./lookup.js";
import { normalizeApplyPaletteOptions } from "./options.js";
import { uint32At } from "./utils.js";
import type {
  ApplyPaletteOptions,
  Format,
  Palette,
  PaletteMapper,
  PaletteMapperOptions,
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

  return createMapper(palette, format, Infinity, "applyPalette").map(rgba);
}

/**
 * Snapshot a palette and reuse exact-color lookup state across animation frames.
 * Dithering is unsupported. The bounded cache is cleared when it fills;
 * eviction and reset affect performance only, never the mapped colors.
 */
export function createPaletteMapper(
  palette: Palette,
  options: Format | PaletteMapperOptions | null = "rgb565",
): PaletteMapper {
  const opts = normalizeApplyPaletteOptions(options);
  if (opts.dither || opts.temporalDither) {
    throw new Error("createPaletteMapper() does not support dithering options");
  }
  assertPalette(palette, "createPaletteMapper");
  assertPaletteMatchesFormat(palette, opts.format, "createPaletteMapper");
  const maxCacheEntries =
    typeof options === "object" && options !== null
      ? (options.maxCacheEntries ?? 262144)
      : 262144;
  if (!Number.isSafeInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new Error(
      "createPaletteMapper() expected maxCacheEntries to be a positive safe integer",
    );
  }
  return createMapper(
    palette,
    opts.format,
    maxCacheEntries,
    "PaletteMapper.map",
  );
}

function createMapper(
  palette: Palette,
  format: Format,
  maxCacheEntries: number,
  functionName: string,
): PaletteMapper {
  const nearest = createPaletteLookup(palette, format === "rgba4444");
  const cache = new Map<number, number>();
  return {
    format,
    map,
    reset: () => {
      cache.clear();
    },
  };

  function remember(key: number, index: number): void {
    if (cache.size >= maxCacheEntries) cache.clear();
    cache.set(key, index);
  }

  function map(rgba: RGBAInput): Uint8Array {
    assertRgbaInput(rgba, functionName);
    const data = createUint32PixelView(rgba, functionName);
    const length = data.length;
    const index = new Uint8Array(length);
    // Cache complete source colors so collisions cannot make a pixel's mapping
    // depend on the order in which other pixels were encountered.

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
          idx = nearest(r, g, b, a);
          remember(key, idx);
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
          idx = nearest(r, g, b);
          remember(key, idx);
        }
        index[i] = idx;
      }
    }

    return index;
  }
}
