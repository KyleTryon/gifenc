function channel(array: readonly number[], index: number): number {
  const value = array[index];
  if (value == null) {
    throw new Error(`Expected color channel ${String(index)}`);
  }
  return value;
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
