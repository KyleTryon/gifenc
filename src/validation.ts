import type { Color, Format, Palette } from "./types.js";

const FORMATS = new Set<Format>(["rgb565", "rgb444", "rgba4444"]);

export function describeValue(value: unknown): string {
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

function assertColor(color: unknown, label: string): asserts color is Color {
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

export function assertColorDepth(
  colorDepth: unknown,
  functionName: string,
): void {
  if (
    typeof colorDepth !== "number" ||
    !Number.isInteger(colorDepth) ||
    colorDepth < 1 ||
    colorDepth > 8
  ) {
    throw new Error(
      `${functionName}() expected colorDepth to be an integer in the range 1..8`,
    );
  }
}

export function assertTransparentIndex(
  transparentIndex: unknown,
  functionName: string,
): void {
  if (
    typeof transparentIndex !== "number" ||
    !Number.isInteger(transparentIndex) ||
    transparentIndex > 255
  ) {
    throw new Error(
      `${functionName}() expected transparentIndex to be an integer in the range 0..255 (negative values disable transparency)`,
    );
  }
}

export function assertDelay(delay: unknown, functionName: string): void {
  if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
    throw new Error(
      `${functionName}() expected delay to be a non-negative number of milliseconds`,
    );
  }
}

export function assertRepeat(repeat: unknown, functionName: string): void {
  if (
    typeof repeat !== "number" ||
    !Number.isInteger(repeat) ||
    repeat < -1 ||
    repeat > 0xffff
  ) {
    throw new Error(
      `${functionName}() expected repeat to be an integer in the range -1..65535`,
    );
  }
}

export function assertDispose(dispose: unknown, functionName: string): void {
  if (
    typeof dispose !== "number" ||
    !Number.isInteger(dispose) ||
    dispose > 7
  ) {
    throw new Error(
      `${functionName}() expected dispose to be an integer, negative for the encoder default or in the range 0..7`,
    );
  }
}
