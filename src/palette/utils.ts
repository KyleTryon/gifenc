import type { Color, Palette, RGBAInput } from "../types.js";

export function roundStep(byte: number, step: number): number {
  return step > 1 ? Math.round(byte / step) * step : byte;
}

export function uint32At(data: Uint32Array, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected uint32 pixel at index ${String(index)}`);
  }
  return value;
}

export function byteAt(data: RGBAInput, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected RGBA byte at index ${String(index)}`);
  }
  return value;
}

export function colorAt(colors: Palette, index: number): Color {
  const color = colors[index];
  if (!color) {
    throw new Error(`Expected palette color at index ${String(index)}`);
  }
  return color;
}

function colorChannel(
  color: readonly number[],
  index: number,
  fallback?: number,
): number {
  const value = color[index] ?? fallback;
  if (value == null) {
    throw new Error(`Expected color channel ${String(index)}`);
  }
  return value;
}

export const red = (color: readonly number[]): number => colorChannel(color, 0);
export const green = (color: readonly number[]): number =>
  colorChannel(color, 1);
export const blue = (color: readonly number[]): number =>
  colorChannel(color, 2);
export const alpha = (color: readonly number[]): number =>
  colorChannel(color, 3, 0xff);

export function toRGB(color: readonly number[]): Color {
  return [red(color), green(color), blue(color)];
}

export function cloneColor(color: readonly number[]): Color {
  return color.length >= 4
    ? [red(color), green(color), blue(color), alpha(color)]
    : toRGB(color);
}

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

export function sqr(value: number): number {
  return value * value;
}
