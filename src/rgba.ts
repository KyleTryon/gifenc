import type { RGBAInput } from "./types.js";

const BYTES_PER_PIXEL = 4;

export function assertRgbaInput(
  rgba: unknown,
  functionName: string,
): asserts rgba is RGBAInput {
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error(`${functionName}() expected RGBA Uint8Array data`);
  }
}

export function assertRgbaByteLength(
  rgba: RGBAInput,
  functionName: string,
): void {
  if (rgba.byteLength % BYTES_PER_PIXEL !== 0) {
    throw new Error(
      `${functionName}() expected RGBA byte length to divide by 4`,
    );
  }
}

export function createUint32PixelView(
  rgba: RGBAInput,
  functionName: string,
): Uint32Array {
  assertRgbaByteLength(rgba, functionName);

  if (rgba.byteOffset % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(
      `${functionName}() requires RGBA data to start on a 4-byte boundary`,
    );
  }

  return new Uint32Array(
    rgba.buffer,
    rgba.byteOffset,
    rgba.byteLength / BYTES_PER_PIXEL,
  );
}
