import type { Palette } from "../types.js";
import { colorAt } from "./utils.js";

/**
 * Snapshot palette channels once for both exact mapping and error diffusion.
 *
 * Returns the index of the nearest palette color by squared Euclidean
 * distance (RGB, or RGBA when `hasAlpha`). When several entries are equally
 * near, the highest index wins, matching a plain linear scan that accepts
 * equal distances.
 *
 * Entries are sorted by a leading channel, the one with the widest spread
 * across the palette, and the search walks outward from the query's position
 * in that order. Once the leading-channel gap alone exceeds the best distance
 * found, no entry further out can win, so most lookups touch only a few
 * entries instead of the whole palette.
 *
 * With alpha, a fully transparent query maps to the nearest fully transparent
 * entry when the palette has one. Its RGB is invisible, and quantization
 * clears transparent entries' RGB, so plain distance would otherwise send
 * transparent white pixels to an opaque color.
 */
export function createPaletteLookup(
  palette: Palette,
  hasAlpha: boolean,
): (r: number, g: number, b: number, a?: number) => number {
  const length = palette.length;
  const channels = hasAlpha ? 4 : 3;
  const channelAt = (i: number, c: number): number =>
    colorAt(palette, i)[c] ?? 255;

  // Lead with the channel of greatest variance, so the sort prunes the most.
  let leadChannel = 0;
  let bestVariance = -1;
  for (let c = 0; c < channels; c++) {
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < length; i++) {
      const value = channelAt(i, c);
      sum += value;
      sumSq += value * value;
    }
    const variance = length ? sumSq / length - (sum / length) ** 2 : 0;
    if (variance > bestVariance) {
      bestVariance = variance;
      leadChannel = c;
    }
  }
  // The remaining channels, in RGBA order, compared after the lead channel.
  const rest = [0, 1, 2, 3].filter((c) => c < channels && c !== leadChannel);
  const restA = rest[0] ?? 0;
  const restB = rest[1] ?? 0;
  const restC = rest[2] ?? 0;

  const order = Array.from({ length }, (_, i) => i);
  order.sort(
    (x, y) => channelAt(x, leadChannel) - channelAt(y, leadChannel) || x - y,
  );

  // Channels stored in sorted order, alongside each entry's original index.
  const indexes = new Uint16Array(length);
  const leads = new Int32Array(length);
  const as = new Int32Array(length);
  const bs = new Int32Array(length);
  const cs = new Int32Array(length);
  for (let s = 0; s < length; s++) {
    const i = order[s] ?? 0;
    indexes[s] = i;
    leads[s] = channelAt(i, leadChannel);
    as[s] = channelAt(i, restA);
    bs[s] = channelAt(i, restB);
    cs[s] = channelAt(i, restC);
  }

  // Fully transparent entries, with their RGB, for alpha-0 queries.
  const transparentList: number[] = [];
  if (hasAlpha) {
    for (let i = 0; i < length; i++) {
      if (channelAt(i, 3) === 0) transparentList.push(i);
    }
  }
  const transparentCount = transparentList.length;
  const transparent = Uint16Array.from(transparentList);
  const transparentReds = new Int32Array(transparentCount);
  const transparentGreens = new Int32Array(transparentCount);
  const transparentBlues = new Int32Array(transparentCount);
  for (let t = 0; t < transparentCount; t++) {
    const i = transparent[t] ?? 0;
    transparentReds[t] = channelAt(i, 0);
    transparentGreens[t] = channelAt(i, 1);
    transparentBlues[t] = channelAt(i, 2);
  }

  // starts[v] is the first sorted position whose leading channel is >= v.
  const starts = new Uint16Array(257);
  for (let v = 0, s = 0; v <= 256; v++) {
    while (s < length && (leads[s] ?? 0) < v) s++;
    starts[v] = s;
  }

  return hasAlpha ? nearestRGBA : nearestRGB;

  function nearestRGB(r: number, g: number, b: number): number {
    return search(
      leadChannel === 0 ? r : leadChannel === 1 ? g : b,
      restA === 0 ? r : g,
      restB === 1 ? g : b,
      0,
      false,
    );
  }

  function nearestRGBA(r: number, g: number, b: number, a = 255): number {
    if (a === 0 && transparentCount) return nearestTransparent(r, g, b);
    return search(
      pick(leadChannel, r, g, b, a),
      pick(restA, r, g, b, a),
      pick(restB, r, g, b, a),
      pick(restC, r, g, b, a),
      true,
    );
  }

  function nearestTransparent(r: number, g: number, b: number): number {
    let nearest = 0;
    let distance = Infinity;
    for (let t = 0; t < transparentCount; t++) {
      const dr = (transparentReds[t] ?? 0) - r;
      const dg = (transparentGreens[t] ?? 0) - g;
      const db = (transparentBlues[t] ?? 0) - b;
      const next = dr * dr + dg * dg + db * db;
      // Entries are in index order, so <= keeps the highest index on ties.
      if (next <= distance) {
        distance = next;
        nearest = transparent[t] ?? 0;
      }
    }
    return nearest;
  }

  function pick(c: number, r: number, g: number, b: number, a: number) {
    return c === 0 ? r : c === 1 ? g : c === 2 ? b : a;
  }

  function search(
    lead: number,
    qa: number,
    qb: number,
    qc: number,
    fourChannels: boolean,
  ): number {
    let nearest = 0;
    let distance = Infinity;
    const start =
      starts[lead < 0 ? 0 : lead > 256 ? 256 : Math.ceil(lead)] ?? 0;
    // Walk up (leading gap >= 0, growing), then down (gap > 0, growing).
    for (let pass = 0; pass < 2; pass++) {
      const step = pass === 0 ? 1 : -1;
      const end = pass === 0 ? length : -1;
      for (let s = pass === 0 ? start : start - 1; s !== end; s += step) {
        const dl = (leads[s] ?? 0) - lead;
        let next = dl * dl;
        if (next > distance) break;
        const da = (as[s] ?? 0) - qa;
        next += da * da;
        if (next > distance) continue;
        const db = (bs[s] ?? 0) - qb;
        next += db * db;
        if (next > distance) continue;
        if (fourChannels) {
          const dc = (cs[s] ?? 0) - qc;
          next += dc * dc;
          if (next > distance) continue;
        }
        const i = indexes[s] ?? 0;
        if (next < distance || i > nearest) {
          distance = next;
          nearest = i;
        }
      }
    }
    return nearest;
  }
}
