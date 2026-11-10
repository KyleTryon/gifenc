import type { Palette } from "../types.js";
import { colorAt } from "./utils.js";

/** Snapshot palette channels once for both exact mapping and error diffusion. */
export function createPaletteLookup(
  palette: Palette,
  hasAlpha: boolean,
): (r: number, g: number, b: number, a?: number) => number {
  const length = palette.length;
  const reds = new Uint8Array(length);
  const greens = new Uint8Array(length);
  const blues = new Uint8Array(length);
  const alphas = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const color = colorAt(palette, i);
    reds[i] = color[0];
    greens[i] = color[1];
    blues[i] = color[2];
    alphas[i] = color[3] ?? 255;
  }
  return hasAlpha ? nearestRGBA : nearestRGB;

  function nearestRGB(r: number, g: number, b: number): number {
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < length; i++) {
      const dr = (reds[i] ?? 0) - r;
      let next = dr * dr;
      if (next > distance) continue;
      const dg = (greens[i] ?? 0) - g;
      next += dg * dg;
      if (next > distance) continue;
      const db = (blues[i] ?? 0) - b;
      next += db * db;
      if (next > distance) continue;
      distance = next;
      nearest = i;
    }
    return nearest;
  }

  function nearestRGBA(r: number, g: number, b: number, a = 255): number {
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < length; i++) {
      const da = (alphas[i] ?? 255) - a;
      let next = da * da;
      if (next > distance) continue;
      const dr = (reds[i] ?? 0) - r;
      next += dr * dr;
      if (next > distance) continue;
      const dg = (greens[i] ?? 0) - g;
      next += dg * dg;
      if (next > distance) continue;
      const db = (blues[i] ?? 0) - b;
      next += db * db;
      if (next > distance) continue;
      distance = next;
      nearest = i;
    }
    return nearest;
  }
}
