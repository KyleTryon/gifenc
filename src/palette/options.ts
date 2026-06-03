import { normalizeFormat } from "../validation.js";
import { describeValue } from "./utils.js";
import type {
  ApplyPaletteOptions,
  DitherAlgorithm,
  Format,
  TemporalDitherState,
} from "../types.js";

export type NormalizedApplyPaletteOptions = {
  format: Format;
  dither: DitherAlgorithm | false;
  width: number | undefined;
  height: number | undefined;
  ditherStrength: number;
  serpentine: boolean;
  temporalDither: TemporalDitherState | null;
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
      temporalDither: null,
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
      temporalDither: null,
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

  const rawTemporalDither: unknown = options.temporalDither;
  let temporalDither: TemporalDitherState | null = null;
  if (rawTemporalDither != null && rawTemporalDither !== false) {
    if (typeof rawTemporalDither !== "object") {
      throw new Error(
        `applyPalette() unsupported temporalDither value: ${describeValue(
          rawTemporalDither,
        )}`,
      );
    }
    temporalDither = rawTemporalDither as TemporalDitherState;
  }

  return {
    format: normalizeFormat(options.format, "applyPalette"),
    dither: dither || false,
    width: options.width,
    height: options.height,
    ditherStrength: Math.max(0, ditherStrength),
    serpentine: options.serpentine !== false,
    temporalDither,
  };
}
