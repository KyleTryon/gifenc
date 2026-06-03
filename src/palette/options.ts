import { normalizeFormat } from "../validation.js";
import { describeValue } from "./utils.js";
import type { ApplyPaletteOptions, DitherAlgorithm, Format } from "../types.js";

export type NormalizedApplyPaletteOptions = {
  format: Format;
  dither: DitherAlgorithm | false;
  width: number | undefined;
  height: number | undefined;
  ditherStrength: number;
  serpentine: boolean;
};

export function normalizeApplyPaletteOptions(
  options: Format | ApplyPaletteOptions | null,
): NormalizedApplyPaletteOptions {
  if (typeof options === "string") {
    return {
      format: normalizeFormat(options, "applyPalette"),
      dither: false,
      width: undefined,
      height: undefined,
      ditherStrength: 1,
      serpentine: true,
    };
  }
  if (options == null) {
    return {
      format: "rgb565",
      dither: false,
      width: undefined,
      height: undefined,
      ditherStrength: 1,
      serpentine: true,
    };
  }
  if (typeof options !== "object") {
    throw new Error(
      "applyPalette() expected options to be a format string or an options object",
    );
  }

  const rawDither: unknown = options.dither;
  let dither: DitherAlgorithm | false = false;
  if (rawDither === true || rawDither === "floyd-steinberg") {
    dither = "floyd-steinberg";
  } else if (rawDither) {
    throw new Error(
      `applyPalette() unsupported dither algorithm: ${describeValue(
        rawDither,
      )}`,
    );
  }

  let ditherStrength = 1;
  if (dither) {
    const rawDitherStrength: unknown = options.ditherStrength;
    ditherStrength = rawDitherStrength == null ? 1 : Number(rawDitherStrength);
    if (!Number.isFinite(ditherStrength)) {
      throw new Error("applyPalette() expected ditherStrength to be a number");
    }
  }

  return {
    format: normalizeFormat(options.format, "applyPalette"),
    dither: dither || false,
    width: options.width,
    height: options.height,
    ditherStrength: Math.max(0, ditherStrength),
    serpentine: options.serpentine !== false,
  };
}
