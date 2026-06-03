import {
  rgb888_to_rgb444,
  rgb888_to_rgb565,
  rgba8888_to_rgba4444,
} from "./rgb-packing.js";

import { euclideanDistanceSquared } from "./color.js";

import type {
  ApplyPaletteOptions,
  DitherAlgorithm,
  DistanceFn,
  Format,
  Palette,
  PrequantizeOptions,
  RGBAInput,
} from "./types.js";

type NormalizedApplyPaletteOptions = {
  format: Format;
  dither: DitherAlgorithm | false;
  width: number | undefined;
  height: number | undefined;
  ditherStrength: number;
  serpentine: boolean;
};

function roundStep(byte: number, step: number): number {
  return step > 1 ? Math.round(byte / step) * step : byte;
}

function uint32At(data: Uint32Array, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected uint32 pixel at index ${String(index)}`);
  }
  return value;
}

function byteAt(data: RGBAInput, index: number): number {
  const value = data[index];
  if (value == null) {
    throw new Error(`Expected RGBA byte at index ${String(index)}`);
  }
  return value;
}

function colorAt(colors: Palette, index: number): number[] {
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

const red = (color: readonly number[]): number => colorChannel(color, 0);
const green = (color: readonly number[]): number => colorChannel(color, 1);
const blue = (color: readonly number[]): number => colorChannel(color, 2);
const alpha = (color: readonly number[]): number =>
  colorChannel(color, 3, 0xff);

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

export function prequantize(
  rgba: RGBAInput,
  {
    roundRGB = 5,
    roundAlpha = 10,
    oneBitAlpha = null,
  }: PrequantizeOptions = {},
): void {
  const data = new Uint32Array(rgba.buffer);
  for (let i = 0; i < data.length; i++) {
    const color = uint32At(data, i);
    let a = (color >> 24) & 0xff;
    let b = (color >> 16) & 0xff;
    let g = (color >> 8) & 0xff;
    let r = color & 0xff;

    a = roundStep(a, roundAlpha);
    if (oneBitAlpha) {
      const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
      a = a <= threshold ? 0x00 : 0xff;
    }
    r = roundStep(r, roundRGB);
    g = roundStep(g, roundRGB);
    b = roundStep(b, roundRGB);

    data[i] = (a << 24) | (b << 16) | (g << 8) | (r << 0);
  }
}

export function applyPalette(
  rgba: RGBAInput,
  palette: Palette,
  options: Format | ApplyPaletteOptions | null = "rgb565",
): Uint8Array {
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error("applyPalette() expected RGBA Uint8Array data");
  }
  if (palette.length > 256) {
    throw new Error("applyPalette() only works with 256 colors or less");
  }

  const opts = normalizeApplyPaletteOptions(options);
  const { format } = opts;
  if (opts.dither) {
    return applyPaletteDither(rgba, palette, opts);
  }

  const data = new Uint32Array(rgba.buffer);
  const length = data.length;
  const bincount = format === "rgb444" ? 4096 : 65536;
  const index = new Uint8Array(length);
  const cache: Array<number | undefined> = new Array<number | undefined>(
    bincount,
  );

  // Some duplicate code below due to very hot code path
  // Introducing branching/conditions shows some significant impact
  if (format === "rgba4444") {
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const a = (color >> 24) & 0xff;
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = rgba8888_to_rgba4444(r, g, b, a);
      let idx = cache[key];
      if (idx == null) {
        idx = cache[key] = nearestColorIndexRGBA(r, g, b, a, palette);
      }
      index[i] = idx;
    }
  } else {
    const rgb888_to_key =
      format === "rgb444" ? rgb888_to_rgb444 : rgb888_to_rgb565;
    for (let i = 0; i < length; i++) {
      const color = uint32At(data, i);
      const b = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const r = color & 0xff;
      const key = rgb888_to_key(r, g, b);
      let idx = cache[key];
      if (idx == null) {
        idx = cache[key] = nearestColorIndexRGB(r, g, b, palette);
      }
      index[i] = idx;
    }
  }

  return index;
}

function normalizeApplyPaletteOptions(
  options: Format | ApplyPaletteOptions | null,
): NormalizedApplyPaletteOptions {
  if (typeof options === "string") {
    return {
      format: options,
      dither: false,
      width: undefined,
      height: undefined,
      ditherStrength: 1,
      serpentine: true,
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

  return {
    format: options.format || "rgb565",
    dither: dither || false,
    width: options.width,
    height: options.height,
    ditherStrength: Math.max(0, ditherStrength),
    serpentine: options.serpentine !== false,
  };
}

function applyPaletteDither(
  rgba: RGBAInput,
  palette: Palette,
  opts: NormalizedApplyPaletteOptions,
): Uint8Array {
  const { format, width, height, ditherStrength, serpentine } = opts;
  const length = rgba.length / 4;
  if (length !== Math.floor(length)) {
    throw new Error("applyPalette() expected RGBA data length to divide by 4");
  }
  if (!width || width < 1 || width !== Math.floor(width)) {
    throw new Error("applyPalette() requires { width } when dithering");
  }

  const resolvedHeight = height == null ? length / width : height;
  if (
    resolvedHeight < 1 ||
    resolvedHeight !== Math.floor(resolvedHeight) ||
    width * resolvedHeight !== length
  ) {
    throw new Error(
      "applyPalette() requires { width, height } to match RGBA data when dithering",
    );
  }

  const hasAlpha = format === "rgba4444";
  const channels = hasAlpha ? 4 : 3;
  const pixels = new Float32Array(length * channels);
  const index = new Uint8Array(length);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += channels) {
    pixels[j] = byteAt(rgba, i);
    pixels[j + 1] = byteAt(rgba, i + 1);
    pixels[j + 2] = byteAt(rgba, i + 2);
    if (hasAlpha) pixels[j + 3] = byteAt(rgba, i + 3);
  }

  for (let y = 0; y < resolvedHeight; y++) {
    const reverse = serpentine && y % 2 === 1;
    const xStart = reverse ? width - 1 : 0;
    const xEnd = reverse ? -1 : width;
    const step = reverse ? -1 : 1;

    for (let x = xStart; x !== xEnd; x += step) {
      const idx = y * width + x;
      const pixelOffset = idx * channels;
      const r = clampByte(pixels[pixelOffset] ?? 0);
      const g = clampByte(pixels[pixelOffset + 1] ?? 0);
      const b = clampByte(pixels[pixelOffset + 2] ?? 0);
      const a = hasAlpha ? clampByte(pixels[pixelOffset + 3] ?? 0xff) : 0xff;
      const paletteIndex = hasAlpha
        ? nearestColorIndexRGBA(r, g, b, a, palette)
        : nearestColorIndexRGB(r, g, b, palette);
      const color = palette[paletteIndex];
      if (!color) {
        throw new Error(
          "applyPalette() expected a non-empty palette when dithering",
        );
      }

      index[idx] = paletteIndex;
      diffuseError(
        pixels,
        channels,
        width,
        resolvedHeight,
        x,
        y,
        reverse,
        ditherStrength,
        r - red(color),
        g - green(color),
        b - blue(color),
        hasAlpha ? a - alpha(color) : 0,
      );
    }
  }

  return index;
}

function diffuseError(
  pixels: Float32Array,
  channels: number,
  width: number,
  height: number,
  x: number,
  y: number,
  reverse: boolean,
  strength: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
): void {
  const direction = reverse ? -1 : 1;
  addError(
    pixels,
    channels,
    width,
    height,
    x + direction,
    y,
    er,
    eg,
    eb,
    ea,
    (strength * 7) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    height,
    x - direction,
    y + 1,
    er,
    eg,
    eb,
    ea,
    (strength * 3) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    height,
    x,
    y + 1,
    er,
    eg,
    eb,
    ea,
    (strength * 5) / 16,
  );
  addError(
    pixels,
    channels,
    width,
    height,
    x + direction,
    y + 1,
    er,
    eg,
    eb,
    ea,
    (strength * 1) / 16,
  );
}

function addError(
  pixels: Float32Array,
  channels: number,
  width: number,
  height: number,
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  ea: number,
  amount: number,
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const idx = (y * width + x) * channels;
  pixels[idx] = (pixels[idx] ?? 0) + er * amount;
  pixels[idx + 1] = (pixels[idx + 1] ?? 0) + eg * amount;
  pixels[idx + 2] = (pixels[idx + 2] ?? 0) + eb * amount;
  if (channels === 4) pixels[idx + 3] = (pixels[idx + 3] ?? 0) + ea * amount;
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 0xff ? 0xff : Math.round(value);
}

function nearestColorIndexRGBA(
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

function nearestColorIndexRGB(
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

  const paletteRGB = palette.map((p) => p.slice(0, 3));
  const thresholdSq = threshold * threshold;
  const dim = colorAt(palette, 0).length;
  for (let i = 0; i < knownColors.length; i++) {
    let color = colorAt(knownColors, i);
    if (color.length < dim) {
      // palette is RGBA, known is RGB
      color = [red(color), green(color), blue(color), 0xff];
    } else if (color.length > dim) {
      // palette is RGB, known is RGBA
      color = color.slice(0, 3);
    } else {
      // make sure we always copy known colors
      color = color.slice();
    }
    const r = nearestColorIndexWithDistance(
      paletteRGB,
      color.slice(0, 3),
      euclideanDistanceSquared,
    );
    const idx = r[0];
    const distanceSq = r[1];
    if (idx >= 0 && distanceSq > 0 && distanceSq <= thresholdSq) {
      palette[idx] = color;
    }
  }
}

function sqr(a: number): number {
  return a * a;
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
): number[] | undefined {
  const index = nearestColorIndex(colors, pixel, distanceFn);
  return index >= 0 ? colors[index] : undefined;
}
