import { euclideanDistanceSquared } from "../color.js";
import { blue, cloneColor, colorAt, green, red, toRGB } from "./utils.js";
import type { Color, DistanceFn, Palette } from "../types.js";

/**
 * Replace near-matching palette entries with known colors in place.
 *
 * This is useful when a generated palette should preserve exact brand colors or
 * transparency keys after quantization.
 *
 * @param palette - Palette to mutate.
 * @param knownColors - Preferred colors to snap into the palette.
 * @param threshold - Maximum Euclidean RGB distance for replacement.
 */
export function snapColorsToPalette(
  palette: Palette,
  knownColors: Palette,
  threshold = 5,
): void {
  if (!palette.length || !knownColors.length) return;

  const dim = colorAt(palette, 0).length;
  // Compare in the palette's own channels, so alpha keeps a transparent entry
  // from being snapped to an opaque known color and vice versa.
  const current = palette.map((color) => toDim(color, dim));
  // Each palette entry may serve at most one known color. An exact match
  // claims its entry too, so a later, merely similar known color cannot
  // overwrite a known color that is already present.
  const claimed = new Uint8Array(palette.length);
  const thresholdSq = threshold * threshold;
  for (let i = 0; i < knownColors.length; i++) {
    const color = toDim(colorAt(knownColors, i), dim);
    let idx = -1;
    let distanceSq = Infinity;
    for (let j = 0; j < current.length; j++) {
      if (claimed[j]) continue;
      const distance = euclideanDistanceSquared(color, colorAt(current, j));
      if (distance < distanceSq) {
        distanceSq = distance;
        idx = j;
      }
    }
    if (idx < 0 || distanceSq > thresholdSq) continue;
    claimed[idx] = 1;
    if (distanceSq > 0) {
      palette[idx] = color;
      current[idx] = cloneColor(color);
    }
  }
}

function toDim(color: readonly number[], dim: number): Color {
  if (color.length < dim) {
    // palette is RGBA, known is RGB
    return [red(color), green(color), blue(color), 0xff];
  }
  if (color.length > dim) {
    // palette is RGB, known is RGBA
    return toRGB(color);
  }
  // make sure we always copy known colors
  return cloneColor(color);
}

/**
 * Find the index of the nearest color in a palette-like list.
 *
 * @param colors - Candidate colors.
 * @param pixel - Color to match.
 * @param distanceFn - Optional distance function. Defaults to squared
 * Euclidean distance.
 * @returns The nearest color index, or `-1` when `colors` is empty.
 */
export function nearestColorIndex(
  colors: Palette,
  pixel: readonly number[],
  distanceFn: DistanceFn = euclideanDistanceSquared,
): number {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colorAt(colors, j);
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return minDistIndex;
}

/**
 * Find the nearest color index and distance in one pass.
 *
 * @param colors - Candidate colors.
 * @param pixel - Color to match.
 * @param distanceFn - Optional distance function. Defaults to squared
 * Euclidean distance.
 * @returns A tuple of `[index, distance]`, with index `-1` and distance
 * `Infinity` when `colors` is empty.
 */
export function nearestColorIndexWithDistance(
  colors: Palette,
  pixel: readonly number[],
  distanceFn: DistanceFn = euclideanDistanceSquared,
): [number, number] {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colorAt(colors, j);
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return [minDistIndex, minDist];
}

/**
 * Find the nearest color in a palette-like list.
 *
 * @param colors - Candidate colors.
 * @param pixel - Color to match.
 * @param distanceFn - Optional distance function. Defaults to squared
 * Euclidean distance.
 * @returns The nearest color, or `undefined` when `colors` is empty.
 */
export function nearestColor(
  colors: Palette,
  pixel: readonly number[],
  distanceFn: DistanceFn = euclideanDistanceSquared,
): Color | undefined {
  const index = nearestColorIndex(colors, pixel, distanceFn);
  return index >= 0 ? colors[index] : undefined;
}
