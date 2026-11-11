import { assertDelay } from "./validation.js";

/**
 * Convert consecutive sequence boundaries in milliseconds to a GIF frame delay.
 * Boundaries are relative to the same sequence origin and are rounded to GIF's
 * 10 ms units before subtraction, preventing per-frame rounding drift.
 */
export function frameDelay(start: number, end: number): number {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    !Number.isSafeInteger(Math.round(end / 10))
  ) {
    throw new Error(
      "frameDelay() expected ordered, non-negative finite millisecond boundaries within the safe integer range",
    );
  }
  assertDelay(end - start, "frameDelay");
  const delay = (Math.round(end / 10) - Math.round(start / 10)) * 10;
  assertDelay(delay, "frameDelay");
  return delay;
}
