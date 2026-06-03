// Modified from:
// https://github.com/mcychan/PnnQuant.js/blob/master/src/pnnquant.js

/* Fast pairwise nearest neighbor based algorithm for multilevel thresholding
Copyright (C) 2004-2019 Mark Tyler and Dmitry Groshev
Copyright (c) 2018-2021 Miller Cy Chan
* error measure; time used is proportional to number of bins squared - WJ */

import {
  rgb888_to_rgb565,
  rgb888_to_rgb444,
  rgba8888_to_rgba4444,
} from "./rgb-packing.js";

import type { Format, Palette, QuantizeOptions, RGBAInput } from "./types.js";

type Bin = {
  ac: number;
  rc: number;
  gc: number;
  bc: number;
  cnt: number;
  nn: number;
  fw: number;
  bk: number;
  tm: number;
  mtm: number;
  err: number;
};

type BinList = Array<Bin | undefined>;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sqr(value: number): number {
  return value * value;
}

function uint32At(data: Uint32Array, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected uint32 pixel at index ${index}`);
  }
  return value;
}

function binAt(bins: BinList, index: number): Bin {
  const bin = bins[index];
  if (!bin) {
    throw new Error(`Expected quantization bin at index ${index}`);
  }
  return bin;
}

function heapAt(heap: Uint32Array, index: number): number {
  const value = heap[index];
  if (value == null) {
    throw new Error(`Expected heap value at index ${index}`);
  }
  return value;
}

function channel(color: readonly number[], index: number): number {
  const value = color[index];
  if (value == null) {
    throw new Error(`Expected color channel ${index}`);
  }
  return value;
}

function find_nn(bins: BinList, idx: number, hasAlpha: boolean): void {
  let nn = 0;
  let err = 1e100;

  const bin1 = binAt(bins, idx);
  const n1 = bin1.cnt;
  const wa = bin1.ac;
  const wr = bin1.rc;
  const wg = bin1.gc;
  const wb = bin1.bc;
  for (let i = bin1.fw; i !== 0; i = binAt(bins, i).fw) {
    const bin = binAt(bins, i);
    const n2 = bin.cnt;
    const nerr2 = (n1 * n2) / (n1 + n2);
    if (nerr2 >= err) continue;

    let nerr = 0;
    if (hasAlpha) {
      nerr += nerr2 * sqr(bin.ac - wa);
      if (nerr >= err) continue;
    }

    nerr += nerr2 * sqr(bin.rc - wr);
    if (nerr >= err) continue;

    nerr += nerr2 * sqr(bin.gc - wg);
    if (nerr >= err) continue;

    nerr += nerr2 * sqr(bin.bc - wb);
    if (nerr >= err) continue;
    err = nerr;
    nn = i;
  }
  bin1.err = err;
  bin1.nn = nn;
}

function createBin(): Bin {
  return {
    ac: 0,
    rc: 0,
    gc: 0,
    bc: 0,
    cnt: 0,
    nn: 0,
    fw: 0,
    bk: 0,
    tm: 0,
    mtm: 0,
    err: 0,
  };
}

function createBinList(data: Uint32Array, format: Format): BinList {
  const bincount = format === "rgb444" ? 4096 : 65536;
  const bins: BinList = new Array(bincount);
  const size = data.length;

  /* Build histogram */
  // Note: Instead of introducing branching/conditions
  // within a very hot per-pixel iteration, we just duplicate the code
  // for each new condition
  if (format === "rgba4444") {
    for (let i = 0; i < size; ++i) {
      const color = uint32At(data, i);
      const a = (color >> 24) & 0xff;
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;

      // reduce to rgb4444 16-bit uint
      const index = rgba8888_to_rgba4444(r, g, b, a);
      const bin = bins[index] ?? (bins[index] = createBin());
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.ac += a;
      bin.cnt++;
    }
  } else if (format === "rgb444") {
    for (let i = 0; i < size; ++i) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;

      // reduce to rgb444 12-bit uint
      const index = rgb888_to_rgb444(r, g, b);
      const bin = bins[index] ?? (bins[index] = createBin());
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.cnt++;
    }
  } else {
    for (let i = 0; i < size; ++i) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;

      // reduce to rgb565 16-bit uint
      const index = rgb888_to_rgb565(r, g, b);
      const bin = bins[index] ?? (bins[index] = createBin());
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.cnt++;
    }
  }
  return bins;
}

export default function quantize(
  rgba: RGBAInput,
  maxColors: number,
  opts: QuantizeOptions = {},
): Palette {
  const {
    format = "rgb565",
    clearAlpha = true,
    clearAlphaColor = 0x00,
    clearAlphaThreshold = 0,
    oneBitAlpha = false,
  } = opts;

  if (!rgba || !rgba.buffer) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }

  const data = new Uint32Array(rgba.buffer);

  let useSqrt = opts.useSqrt !== false;

  // format can be:
  // rgb565 (default)
  // rgb444
  // rgba4444

  const hasAlpha = format === "rgba4444";
  const bins = createBinList(data, format);
  const bincount = bins.length;
  const bincountMinusOne = bincount - 1;
  const heap = new Uint32Array(bincount + 1);

  /* Cluster nonempty bins at one end of array */
  let maxbins = 0;
  for (let i = 0; i < bincount; ++i) {
    const bin = bins[i];
    if (bin != null) {
      const d = 1.0 / bin.cnt;
      if (hasAlpha) bin.ac *= d;
      bin.rc *= d;
      bin.gc *= d;
      bin.bc *= d;
      bins[maxbins++] = bin;
    }
  }

  if (maxbins === 0) {
    return [];
  }

  if (sqr(maxColors) / maxbins < 0.022) {
    useSqrt = false;
  }

  let i = 0;
  for (; i < maxbins - 1; ++i) {
    const bin = binAt(bins, i);
    const nextBin = binAt(bins, i + 1);
    bin.fw = i + 1;
    nextBin.bk = i;
    if (useSqrt) bin.cnt = Math.sqrt(bin.cnt);
  }
  if (useSqrt) {
    const bin = binAt(bins, i);
    bin.cnt = Math.sqrt(bin.cnt);
  }

  let h: number;
  let l: number;
  let l2: number;
  /* Initialize nearest neighbors and build heap of them */
  for (i = 0; i < maxbins; ++i) {
    find_nn(bins, i, false);
    /* Push slot on heap */
    const err = binAt(bins, i).err;
    const heapSize = heapAt(heap, 0) + 1;
    heap[0] = heapSize;
    for (l = heapSize; l > 1; l = l2) {
      l2 = l >> 1;
      h = heapAt(heap, l2);
      if (binAt(bins, h).err <= err) break;
      heap[l] = h;
    }
    heap[l] = i;
  }

  /* Merge bins which increase error the least */
  const extbins = maxbins - maxColors;
  for (i = 0; i < extbins; ) {
    let tb: Bin;
    /* Use heap to find which bins to merge */
    for (;;) {
      let b1 = heapAt(heap, 1);
      tb = binAt(bins, b1); /* One with least error */
      /* Is stored error up to date? */
      if (tb.tm >= tb.mtm && binAt(bins, tb.nn).mtm <= tb.tm) break;
      if (tb.mtm === bincountMinusOne) {
        /* Deleted node */
        b1 = heapAt(heap, heapAt(heap, 0));
        heap[1] = b1;
        heap[0] = heapAt(heap, 0) - 1;
      } else {
        /* Too old error value */
        find_nn(bins, b1, false);
        tb.tm = i;
      }
      /* Push slot down */
      const err = binAt(bins, b1).err;
      for (l = 1; (l2 = l + l) <= heapAt(heap, 0); l = l2) {
        if (
          l2 < heapAt(heap, 0) &&
          binAt(bins, heapAt(heap, l2)).err >
            binAt(bins, heapAt(heap, l2 + 1)).err
        ) {
          l2++;
        }
        h = heapAt(heap, l2);
        if (err <= binAt(bins, h).err) break;
        heap[l] = h;
      }
      heap[l] = b1;
    }

    /* Do a merge */
    const nb = binAt(bins, tb.nn);
    const n1 = tb.cnt;
    const n2 = nb.cnt;
    const d = 1.0 / (n1 + n2);
    if (hasAlpha) tb.ac = d * (n1 * tb.ac + n2 * nb.ac);
    tb.rc = d * (n1 * tb.rc + n2 * nb.rc);
    tb.gc = d * (n1 * tb.gc + n2 * nb.gc);
    tb.bc = d * (n1 * tb.bc + n2 * nb.bc);
    tb.cnt += nb.cnt;
    tb.mtm = ++i;

    /* Unchain deleted bin */
    binAt(bins, nb.bk).fw = nb.fw;
    binAt(bins, nb.fw).bk = nb.bk;
    nb.mtm = bincountMinusOne;
  }

  // let palette = new Uint32Array(maxColors);
  const palette: Palette = [];

  /* Fill palette */
  for (i = 0; ; ) {
    const bin = binAt(bins, i);
    let r = clamp(Math.round(bin.rc), 0, 0xff);
    let g = clamp(Math.round(bin.gc), 0, 0xff);
    let b = clamp(Math.round(bin.bc), 0, 0xff);

    let a = 0xff;
    if (hasAlpha) {
      a = clamp(Math.round(bin.ac), 0, 0xff);
      if (oneBitAlpha) {
        const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
        a = a <= threshold ? 0x00 : 0xff;
      }
      if (clearAlpha && a <= clearAlphaThreshold) {
        r = g = b = clearAlphaColor;
        a = 0x00;
      }
    }

    const color = hasAlpha ? [r, g, b, a] : [r, g, b];
    const exists = existsInPalette(palette, color);
    if (!exists) palette.push(color);
    if ((i = bin.fw) === 0) break;
  }

  return palette;
}

function existsInPalette(palette: Palette, color: number[]): boolean {
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    if (!p) {
      continue;
    }
    const matchesRGB =
      channel(p, 0) === channel(color, 0) &&
      channel(p, 1) === channel(color, 1) &&
      channel(p, 2) === channel(color, 2);
    const matchesAlpha =
      p.length >= 4 && color.length >= 4
        ? channel(p, 3) === channel(color, 3)
        : true;
    if (matchesRGB && matchesAlpha) return true;
  }
  return false;
}

// TODO: Further 'clean' palette by merging nearly-identical colors?
