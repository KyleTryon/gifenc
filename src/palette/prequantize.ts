import { assertRgbaInput, createUint32PixelView } from "../rgba.js";
import { roundStep, uint32At } from "./utils.js";
import type { PrequantizeOptions, RGBAInput } from "../types.js";

/**
 * Mutate RGBA pixels in place to reduce color precision before quantization.
 *
 * This can improve palette stability or reduce dithering noise before calling
 * {@link quantize}. Because this function mutates `rgba`, pass a copy if the
 * original pixel data is still needed.
 *
 * @param rgba - Flat RGBA pixel data in `[r, g, b, a, ...]` order.
 * @param options - Channel rounding and alpha threshold options.
 */
export function prequantize(
  rgba: RGBAInput,
  {
    roundRGB = 5,
    roundAlpha = 10,
    oneBitAlpha = null,
  }: PrequantizeOptions = {},
): void {
  assertRgbaInput(rgba, "prequantize");
  const data = createUint32PixelView(rgba, "prequantize");
  for (let i = 0; i < data.length; i++) {
    const color = uint32At(data, i);
    let a = (color >> 24) & 0xff;
    let b = (color >> 16) & 0xff;
    let g = (color >> 8) & 0xff;
    let r = color & 0xff;

    a = roundStep(a, roundAlpha);
    if (oneBitAlpha) {
      const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
      a = a <= threshold ? 0x00 : 0xff;
    }
    r = roundStep(r, roundRGB);
    g = roundStep(g, roundRGB);
    b = roundStep(b, roundRGB);

    data[i] = (a << 24) | (b << 16) | (g << 8) | (r << 0);
  }
}
