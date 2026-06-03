import { normalizeFormat } from "../validation.js";
import type {
  Format,
  TemporalDitherOptions,
  TemporalDitherState,
} from "../types.js";

const DEFAULT_STRENGTH = 1;
const DEFAULT_DECAY = 0.75;
const DEFAULT_MAX_ERROR = 128;

const buffers = new WeakMap<TemporalDither, Float32Array>();

class TemporalDither implements TemporalDitherState {
  readonly width: number;
  readonly height: number;
  readonly format: Format;
  readonly strength: number;
  readonly decay: number;
  readonly maxError: number;

  constructor(options: TemporalDitherOptions) {
    const rawOptions: unknown = options;
    if (rawOptions == null || typeof rawOptions !== "object") {
      throw new Error("createTemporalDither() expected an options object");
    }

    this.width = normalizeDimension(options.width, "width");
    this.height = normalizeDimension(options.height, "height");
    this.format = normalizeFormat(options.format, "createTemporalDither");
    this.strength = normalizeNonNegative(
      options.strength,
      DEFAULT_STRENGTH,
      "strength",
    );
    this.decay = normalizeUnit(options.decay, DEFAULT_DECAY, "decay");
    this.maxError = normalizeNonNegative(
      options.maxError,
      DEFAULT_MAX_ERROR,
      "maxError",
    );

    buffers.set(
      this,
      new Float32Array(
        this.width * this.height * temporalDitherChannels(this.format),
      ),
    );
  }

  reset(): void {
    const buffer = buffers.get(this);
    if (buffer) buffer.fill(0);
  }
}

export function createTemporalDither(
  options: TemporalDitherOptions,
): TemporalDitherState {
  return new TemporalDither(options);
}

export function temporalDitherChannels(format: Format): 3 | 4 {
  return format === "rgba4444" ? 4 : 3;
}

export function getTemporalDitherBuffer(
  state: TemporalDitherState,
  format: Format,
  width: number,
  height: number,
  functionName: string,
): Float32Array {
  if (!(state instanceof TemporalDither)) {
    throw new Error(
      `${functionName}() expected temporalDither from createTemporalDither()`,
    );
  }
  if (state.width !== width || state.height !== height) {
    throw new Error(
      `${functionName}() expected temporalDither dimensions to match the frame`,
    );
  }
  if (temporalDitherChannels(state.format) !== temporalDitherChannels(format)) {
    throw new Error(
      `${functionName}() expected temporalDither format to match alpha handling`,
    );
  }

  const buffer = buffers.get(state);
  if (!buffer) {
    throw new Error(
      `${functionName}() received an invalid temporalDither state`,
    );
  }
  return buffer;
}

function normalizeDimension(value: unknown, name: string): number {
  const dimension = Number(value);
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new Error(
      `createTemporalDither() expected ${name} to be a positive integer`,
    );
  }
  return dimension;
}

function normalizeNonNegative(
  value: unknown,
  fallback: number,
  name: string,
): number {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`createTemporalDither() expected ${name} to be a number`);
  }
  return Math.max(0, number);
}

function normalizeUnit(value: unknown, fallback: number, name: string): number {
  const number = normalizeNonNegative(value, fallback, name);
  return Math.min(1, number);
}
