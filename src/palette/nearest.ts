import { euclideanDistanceSquared } from "../color.js";
import {
  alpha,
  blue,
  cloneColor,
  colorAt,
  green,
  red,
  sqr,
  toRGB,
} from "./utils.js";
import type { Color, DistanceFn, Palette } from "../types.js";

export function nearestColorIndexRGBA(
  r: number,
  g: number,
  b: number,
  a: number,
  palette: Palette,
): number {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = colorAt(palette, i);
    const a2 = alpha(px2);
    let curdist = sqr(a2 - a);
    if (curdist > mindist) continue;
    const r2 = red(px2);
    curdist += sqr(r2 - r);
    if (curdist > mindist) continue;
    const g2 = green(px2);
    curdist += sqr(g2 - g);
    if (curdist > mindist) continue;
    const b2 = blue(px2);
    curdist += sqr(b2 - b);
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}

export function nearestColorIndexRGB(
  r: number,
  g: number,
  b: number,
  palette: Palette,
): number {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = colorAt(palette, i);
    const r2 = red(px2);
    let curdist = sqr(r2 - r);
    if (curdist > mindist) continue;
    const g2 = green(px2);
    curdist += sqr(g2 - g);
    if (curdist > mindist) continue;
    const b2 = blue(px2);
    curdist += sqr(b2 - b);
    if (curdist > mindist) continue;
    mindist = curdist;
    k = i;
  }
  return k;
}

export function snapColorsToPalette(
  palette: Palette,
  knownColors: Palette,
  threshold = 5,
): void {
  if (!palette.length || !knownColors.length) return;

  const paletteRGB = palette.map(toRGB);
  const thresholdSq = threshold * threshold;
  const dim = colorAt(palette, 0).length;
  for (let i = 0; i < knownColors.length; i++) {
    let color: Color = colorAt(knownColors, i);
    if (color.length < dim) {
      // palette is RGBA, known is RGB
      color = [red(color), green(color), blue(color), 0xff];
    } else if (color.length > dim) {
      // palette is RGB, known is RGBA
      color = toRGB(color);
    } else {
      // make sure we always copy known colors
      color = cloneColor(color);
    }
    const r = nearestColorIndexWithDistance(
      paletteRGB,
      toRGB(color),
      euclideanDistanceSquared,
    );
    const idx = r[0];
    const distanceSq = r[1];
    if (idx >= 0 && distanceSq > 0 && distanceSq <= thresholdSq) {
      palette[idx] = color;
    }
  }
}

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

export function nearestColor(
  colors: Palette,
  pixel: readonly number[],
  distanceFn: DistanceFn = euclideanDistanceSquared,
): Color | undefined {
  const index = nearestColorIndex(colors, pixel, distanceFn);
  return index >= 0 ? colors[index] : undefined;
}
