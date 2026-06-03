import type { Color, Format, Palette } from "./types.js";

const FORMATS = new Set<Format>(["rgb565", "rgb444", "rgba4444"]);

function describeValue(value: unknown): string {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return Object.prototype.toString.call(value);
}

export function normalizeFormat(value: unknown, functionName: string): Format {
  if (value == null) {
    return "rgb565";
  }
  if (typeof value === "string" && FORMATS.has(value as Format)) {
    return value as Format;
  }
  throw new Error(
    `${functionName}() unsupported color format: ${describeValue(value)}`,
  );
}

export function assertMaxColors(maxColors: number, functionName: string): void {
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256) {
    throw new Error(`${functionName}() expected maxColors in the range 1..256`);
  }
}

function assertByte(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xff
  ) {
    throw new Error(`${label} must be an integer byte`);
  }
}

export function assertColor(
  color: unknown,
  label: string,
): asserts color is Color {
  if (!Array.isArray(color) || (color.length !== 3 && color.length !== 4)) {
    throw new Error(`${label} must be an RGB or RGBA color`);
  }

  for (let i = 0; i < color.length; i++) {
    assertByte(color[i], `${label}[${String(i)}]`);
  }
}

export function assertPalette(
  palette: unknown,
  functionName: string,
): asserts palette is Palette {
  if (!Array.isArray(palette)) {
    throw new Error(`${functionName}() expected palette to be an array`);
  }
  if (palette.length < 1 || palette.length > 256) {
    throw new Error(
      `${functionName}() expected palette length in the range 1..256`,
    );
  }

  for (let i = 0; i < palette.length; i++) {
    assertColor(palette[i], `${functionName}() palette[${String(i)}]`);
  }
}

export function assertPaletteMatchesFormat(
  palette: Palette,
  format: Format,
  functionName: string,
): void {
  if (format !== "rgba4444") {
    return;
  }

  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if (color?.length !== 4) {
      throw new Error(
        `${functionName}() expected RGBA palette colors for rgba4444 format`,
      );
    }
  }
}
