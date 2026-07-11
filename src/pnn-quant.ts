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
import { assertRgbaInput, createUint32PixelView } from "./rgba.js";
import { assertMaxColors, normalizeFormat } from "./validation.js";

import type {
  Color,
  Format,
  Palette,
  QuantizeOptions,
  RGBAInput,
} from "./types.js";

type BinList = {
  length: number;
  ac: Float64Array;
  rc: Float64Array;
  gc: Float64Array;
  bc: Float64Array;
  cnt: Float64Array;
  nn: Int32Array;
  fw: Int32Array;
  bk: Int32Array;
  tm: Int32Array;
  mtm: Int32Array;
  err: Float64Array;
};

const DELETED_BIN = 0x7fffffff;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sqr(value: number): number {
  return value * value;
}

function uint32At(data: Uint32Array, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected uint32 pixel at index ${String(index)}`);
  }
  return value;
}

function heapAt(heap: Uint32Array, index: number): number {
  const value = heap[index];
  if (value == null) {
    throw new Error(`Expected heap value at index ${String(index)}`);
  }
  return value;
}

function channel(color: readonly number[], index: number): number {
  const value = color[index];
  if (value == null) {
    throw new Error(`Expected color channel ${String(index)}`);
  }
  return value;
}

function find_nn(bins: BinList, idx: number, hasAlpha: boolean): void {
  let nn = 0;
  let err = 1e100;

  const n1 = bins.cnt[idx] ?? 0;
  const wa = bins.ac[idx] ?? 0;
  const wr = bins.rc[idx] ?? 0;
  const wg = bins.gc[idx] ?? 0;
  const wb = bins.bc[idx] ?? 0;
  for (let i = bins.fw[idx] ?? 0; i !== 0; i = bins.fw[i] ?? 0) {
    const n2 = bins.cnt[i] ?? 0;
    const nerr2 = (n1 * n2) / (n1 + n2);
    if (nerr2 >= err) continue;

    let nerr = 0;
    if (hasAlpha) {
      nerr += nerr2 * sqr((bins.ac[i] ?? 0) - wa);
      if (nerr >= err) continue;
    }

    nerr += nerr2 * sqr((bins.rc[i] ?? 0) - wr);
    if (nerr >= err) continue;

    nerr += nerr2 * sqr((bins.gc[i] ?? 0) - wg);
    if (nerr >= err) continue;

    nerr += nerr2 * sqr((bins.bc[i] ?? 0) - wb);
    if (nerr >= err) continue;
    err = nerr;
    nn = i;
  }
  bins.err[idx] = err;
  bins.nn[idx] = nn;
}

function createBinListBuffer(length: number): BinList {
  return {
    length,
    ac: new Float64Array(length),
    rc: new Float64Array(length),
    gc: new Float64Array(length),
    bc: new Float64Array(length),
    cnt: new Float64Array(length),
    nn: new Int32Array(length),
    fw: new Int32Array(length),
    bk: new Int32Array(length),
    tm: new Int32Array(length),
    mtm: new Int32Array(length),
    err: new Float64Array(length),
  };
}

function createBinList(data: Uint32Array, format: Format): BinList {
  const bincount = format === "rgb444" ? 4096 : 65536;
  const ac = new Float64Array(bincount);
  const rc = new Float64Array(bincount);
  const gc = new Float64Array(bincount);
  const bc = new Float64Array(bincount);
  const cnt = new Uint32Array(bincount);
  const touched = new Uint32Array(bincount);
  let touchedLength = 0;
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
      if (cnt[index] === 0) touched[touchedLength++] = index;
      rc[index] = (rc[index] ?? 0) + r;
      gc[index] = (gc[index] ?? 0) + g;
      bc[index] = (bc[index] ?? 0) + b;
      ac[index] = (ac[index] ?? 0) + a;
      cnt[index] = (cnt[index] ?? 0) + 1;
    }
  } else if (format === "rgb444") {
    for (let i = 0; i < size; ++i) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;

      // reduce to rgb444 12-bit uint
      const index = rgb888_to_rgb444(r, g, b);
      if (cnt[index] === 0) touched[touchedLength++] = index;
      rc[index] = (rc[index] ?? 0) + r;
      gc[index] = (gc[index] ?? 0) + g;
      bc[index] = (bc[index] ?? 0) + b;
      cnt[index] = (cnt[index] ?? 0) + 1;
    }
  } else {
    for (let i = 0; i < size; ++i) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;

      // reduce to rgb565 16-bit uint
      const index = rgb888_to_rgb565(r, g, b);
      if (cnt[index] === 0) touched[touchedLength++] = index;
      rc[index] = (rc[index] ?? 0) + r;
      gc[index] = (gc[index] ?? 0) + g;
      bc[index] = (bc[index] ?? 0) + b;
      cnt[index] = (cnt[index] ?? 0) + 1;
    }
  }

  const bins = createBinListBuffer(touchedLength);
  for (let i = 0; i < touchedLength; i++) {
    const index = touched[i] ?? 0;
    bins.ac[i] = ac[index] ?? 0;
    bins.rc[i] = rc[index] ?? 0;
    bins.gc[i] = gc[index] ?? 0;
    bins.bc[i] = bc[index] ?? 0;
    bins.cnt[i] = cnt[index] ?? 0;
  }
  return bins;
}

/**
 * Reduce flat RGBA pixel data to a GIF-compatible palette.
 *
 * The returned palette contains up to `maxColors` RGB or RGBA colors depending
 * on the selected {@link Format}. Use `"rgba4444"` when the palette itself
 * should preserve alpha; otherwise transparent pixels are typically handled by
 * a transparent palette index when writing frames.
 *
 * @param rgba - Flat RGBA pixel data in `[r, g, b, a, ...]` order.
 * @param maxColors - Maximum palette size, from 1 to 256.
 * @param opts - Quantization options.
 * @returns A palette suitable for {@link applyPalette} and
 * {@link GIFEncoderInstance.writeFrame}.
 */
export default function quantize(
  rgba: RGBAInput,
  maxColors: number,
  opts: QuantizeOptions = {},
): Palette {
  const {
    clearAlpha = true,
    clearAlphaColor = 0x00,
    clearAlphaThreshold = 0,
    oneBitAlpha = false,
  } = opts;

  assertRgbaInput(rgba, "quantize");
  assertMaxColors(maxColors, "quantize");
  const format = normalizeFormat(opts.format, "quantize");
  const data = createUint32PixelView(rgba, "quantize");

  let useSqrt = opts.useSqrt !== false;

  // format can be:
  // rgb565 (default)
  // rgb444
  // rgba4444

  const hasAlpha = format === "rgba4444";
  const bins = createBinList(data, format);
  const maxbins = bins.length;
  const heap = new Uint32Array(maxbins + 1);

  if (maxbins === 0) {
    return [];
  }

  for (let i = 0; i < maxbins; ++i) {
    const d = 1.0 / (bins.cnt[i] ?? 1);
    if (hasAlpha) bins.ac[i] = (bins.ac[i] ?? 0) * d;
    bins.rc[i] = (bins.rc[i] ?? 0) * d;
    bins.gc[i] = (bins.gc[i] ?? 0) * d;
    bins.bc[i] = (bins.bc[i] ?? 0) * d;
  }

  if (sqr(maxColors) / maxbins < 0.022) {
    useSqrt = false;
  }

  let i = 0;
  for (; i < maxbins - 1; ++i) {
    bins.fw[i] = i + 1;
    bins.bk[i + 1] = i;
    if (useSqrt) bins.cnt[i] = Math.sqrt(bins.cnt[i] ?? 0);
  }
  if (useSqrt) {
    bins.cnt[i] = Math.sqrt(bins.cnt[i] ?? 0);
  }

  let h: number;
  let l: number;
  let l2: number;
  /* Initialize nearest neighbors and build heap of them */
  for (i = 0; i < maxbins; ++i) {
    find_nn(bins, i, false);
    /* Push slot on heap */
    const err = bins.err[i] ?? 0;
    const heapSize = heapAt(heap, 0) + 1;
    heap[0] = heapSize;
    for (l = heapSize; l > 1; l = l2) {
      l2 = l >> 1;
      h = heapAt(heap, l2);
      if ((bins.err[h] ?? 0) <= err) break;
      heap[l] = h;
    }
    heap[l] = i;
  }

  /* Merge bins which increase error the least */
  const extbins = maxbins - maxColors;
  for (i = 0; i < extbins; ) {
    let tb: number;
    /* Use heap to find which bins to merge */
    for (;;) {
      let b1 = heapAt(heap, 1);
      tb = b1; /* One with least error */
      /* Is stored error up to date? */
      const tbTm = bins.tm[tb] ?? 0;
      if (
        tbTm >= (bins.mtm[tb] ?? 0) &&
        (bins.mtm[bins.nn[tb] ?? 0] ?? 0) <= tbTm
      ) {
        break;
      }
      if ((bins.mtm[tb] ?? 0) === DELETED_BIN) {
        /* Deleted node */
        b1 = heapAt(heap, heapAt(heap, 0));
        heap[1] = b1;
        heap[0] = heapAt(heap, 0) - 1;
      } else {
        /* Too old error value */
        find_nn(bins, b1, false);
        bins.tm[tb] = i;
      }
      /* Push slot down */
      const err = bins.err[b1] ?? 0;
      for (l = 1; (l2 = l + l) <= heapAt(heap, 0); l = l2) {
        if (
          l2 < heapAt(heap, 0) &&
          (bins.err[heapAt(heap, l2)] ?? 0) >
            (bins.err[heapAt(heap, l2 + 1)] ?? 0)
        ) {
          l2++;
        }
        h = heapAt(heap, l2);
        if (err <= (bins.err[h] ?? 0)) break;
        heap[l] = h;
      }
      heap[l] = b1;
    }

    /* Do a merge */
    const nb = bins.nn[tb] ?? 0;
    const n1 = bins.cnt[tb] ?? 0;
    const n2 = bins.cnt[nb] ?? 0;
    const d = 1.0 / (n1 + n2);
    if (hasAlpha) {
      bins.ac[tb] = d * (n1 * (bins.ac[tb] ?? 0) + n2 * (bins.ac[nb] ?? 0));
    }
    bins.rc[tb] = d * (n1 * (bins.rc[tb] ?? 0) + n2 * (bins.rc[nb] ?? 0));
    bins.gc[tb] = d * (n1 * (bins.gc[tb] ?? 0) + n2 * (bins.gc[nb] ?? 0));
    bins.bc[tb] = d * (n1 * (bins.bc[tb] ?? 0) + n2 * (bins.bc[nb] ?? 0));
    bins.cnt[tb] = n1 + n2;
    bins.mtm[tb] = ++i;

    /* Unchain deleted bin */
    const nbBk = bins.bk[nb] ?? 0;
    const nbFw = bins.fw[nb] ?? 0;
    bins.fw[nbBk] = nbFw;
    bins.bk[nbFw] = nbBk;
    bins.mtm[nb] = DELETED_BIN;
  }

  // let palette = new Uint32Array(maxColors);
  const palette: Palette = [];

  /* Fill palette */
  for (i = 0; ; ) {
    let r = clamp(Math.round(bins.rc[i] ?? 0), 0, 0xff);
    let g = clamp(Math.round(bins.gc[i] ?? 0), 0, 0xff);
    let b = clamp(Math.round(bins.bc[i] ?? 0), 0, 0xff);

    let a = 0xff;
    if (hasAlpha) {
      a = clamp(Math.round(bins.ac[i] ?? 0), 0, 0xff);
      if (oneBitAlpha) {
        const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
        a = a <= threshold ? 0x00 : 0xff;
      }
      if (clearAlpha && a <= clearAlphaThreshold) {
        r = g = b = clearAlphaColor;
        a = 0x00;
      }
    }

    const color: Color = hasAlpha ? [r, g, b, a] : [r, g, b];
    const exists = existsInPalette(palette, color);
    if (!exists) palette.push(color);
    if ((i = bins.fw[i] ?? 0) === 0) break;
  }

  return palette;
}

function existsInPalette(palette: Palette, color: Color): boolean {
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
