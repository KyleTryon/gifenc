function rgb2y(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function rgb2i(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function rgb2q(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

export function colorDifferenceYIQSquared(
  yiqA: readonly number[],
  yiqB: readonly number[],
): number {
  const y = channel(yiqA, 0) - channel(yiqB, 0);
  const i = channel(yiqA, 1) - channel(yiqB, 1);
  const q = channel(yiqA, 2) - channel(yiqB, 2);
  const a = alpha(yiqA) - alpha(yiqB);
  return y * y * 0.5053 + i * i * 0.299 + q * q * 0.1957 + a * a;
}

function channel(array: readonly number[], index: number): number {
  const value = array[index];
  if (value == null) {
    throw new Error(`Expected color channel ${String(index)}`);
  }
  return value;
}

function alpha(array: readonly number[]): number {
  return array[3] ?? 0xff;
}

export function colorDifferenceYIQ(
  yiqA: readonly number[],
  yiqB: readonly number[],
): number {
  return Math.sqrt(colorDifferenceYIQSquared(yiqA, yiqB));
}

export function colorDifferenceRGBToYIQSquared(
  rgb1: readonly number[],
  rgb2: readonly number[],
): number {
  const r1 = channel(rgb1, 0);
  const g1 = channel(rgb1, 1);
  const b1 = channel(rgb1, 2);
  const r2 = channel(rgb2, 0);
  const g2 = channel(rgb2, 1);
  const b2 = channel(rgb2, 2);
  const y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2),
    i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2),
    q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
  const a = alpha(rgb1) - alpha(rgb2);
  return y * y * 0.5053 + i * i * 0.299 + q * q * 0.1957 + a * a;
}

export function colorDifferenceRGBToYIQ(
  rgb1: readonly number[],
  rgb2: readonly number[],
): number {
  return Math.sqrt(colorDifferenceRGBToYIQSquared(rgb1, rgb2));
}

export function euclideanDistanceSquared(
  a: readonly number[],
  b: readonly number[],
): number {
  let sum = 0;
  for (let n = 0; n < a.length; n++) {
    const dx = channel(a, n) - channel(b, n);
    sum += dx * dx;
  }
  return sum;
}

export function euclideanDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  return Math.sqrt(euclideanDistanceSquared(a, b));
}
