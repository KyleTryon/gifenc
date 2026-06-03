import { normalizeFormat } from "../validation.js";
import { byteAt } from "./utils.js";
import type {
  Format,
  RGBAInput,
  TemporalDitherOptions,
  TemporalDitherState,
} from "../types.js";

const DEFAULT_STRENGTH = 1;
const DEFAULT_DECAY = 0.75;
const DEFAULT_MAX_ERROR = 128;
const DEFAULT_CHANGE_PIXEL_THRESHOLD = 48;
const DEFAULT_SCENE_CHANGE_RATIO = 0.75;

const buffers = new WeakMap<TemporalDither, Float32Array>();
const previousFrames = new WeakMap<TemporalDither, PreviousFrame>();

type ChangeDetection = {
  readonly pixelThreshold: number;
  readonly sceneChangeRatio: number;
};

type PreviousFrame = {
  bytes: Uint8Array;
  hasFrame: boolean;
};

class TemporalDither implements TemporalDitherState {
  readonly width: number;
  readonly height: number;
  readonly format: Format;
  readonly strength: number;
  readonly decay: number;
  readonly maxError: number;
  readonly changeDetection: false | ChangeDetection;

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
    this.changeDetection = normalizeChangeDetection(options.changeDetection);

    buffers.set(
      this,
      new Float32Array(
        this.width * this.height * temporalDitherChannels(this.format),
      ),
    );
    if (this.changeDetection) {
      previousFrames.set(this, {
        bytes: new Uint8Array(
          this.width * this.height * temporalDitherChannels(this.format),
        ),
        hasFrame: false,
      });
    }
  }

  reset(): void {
    const buffer = buffers.get(this);
    if (buffer) buffer.fill(0);
    const previousFrame = previousFrames.get(this);
    if (previousFrame) {
      previousFrame.bytes.fill(0);
      previousFrame.hasFrame = false;
    }
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

function getTemporalDitherBuffer(
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

export function prepareTemporalDitherFrame(
  state: TemporalDitherState,
  rgba: RGBAInput,
  format: Format,
  width: number,
  height: number,
  functionName: string,
): Float32Array {
  const buffer = getTemporalDitherBuffer(
    state,
    format,
    width,
    height,
    functionName,
  );
  rejectChangedHistory(state, rgba, format, buffer);
  return buffer;
}

export function commitTemporalDitherFrame(
  state: TemporalDitherState,
  rgba: RGBAInput,
  format: Format,
  width: number,
  height: number,
  functionName: string,
): void {
  getTemporalDitherBuffer(state, format, width, height, functionName);
  const temporal = getTemporalDitherState(state, functionName);
  const previousFrame = previousFrames.get(temporal);
  if (!previousFrame) return;

  copySourceFrame(previousFrame.bytes, rgba, temporalDitherChannels(format));
  previousFrame.hasFrame = true;
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

function normalizeChangeDetection(
  value: TemporalDitherOptions["changeDetection"],
): false | ChangeDetection {
  if (value === false) return false;
  if (value == null || value === true) {
    return {
      pixelThreshold: DEFAULT_CHANGE_PIXEL_THRESHOLD,
      sceneChangeRatio: DEFAULT_SCENE_CHANGE_RATIO,
    };
  }
  if (typeof value !== "object") {
    throw new Error(
      "createTemporalDither() expected changeDetection to be a boolean or options object",
    );
  }

  return {
    pixelThreshold: normalizeNonNegative(
      value.pixelThreshold,
      DEFAULT_CHANGE_PIXEL_THRESHOLD,
      "changeDetection.pixelThreshold",
    ),
    sceneChangeRatio: normalizeUnit(
      value.sceneChangeRatio,
      DEFAULT_SCENE_CHANGE_RATIO,
      "changeDetection.sceneChangeRatio",
    ),
  };
}

function getTemporalDitherState(
  state: TemporalDitherState,
  functionName: string,
): TemporalDither {
  if (!(state instanceof TemporalDither)) {
    throw new Error(
      `${functionName}() expected temporalDither from createTemporalDither()`,
    );
  }
  return state;
}

function rejectChangedHistory(
  state: TemporalDitherState,
  rgba: RGBAInput,
  format: Format,
  errors: Float32Array,
): void {
  const temporal = getTemporalDitherState(state, "applyPalette");
  if (!temporal.changeDetection) return;

  const previousFrame = previousFrames.get(temporal);
  if (!previousFrame?.hasFrame) return;

  const channels = temporalDitherChannels(format);
  const pixelThresholdSq =
    temporal.changeDetection.pixelThreshold *
    temporal.changeDetection.pixelThreshold;
  let changedPixels = 0;

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += channels) {
    let distance = channelDistanceSq(rgba, previousFrame.bytes, i, j, 0);
    distance += channelDistanceSq(rgba, previousFrame.bytes, i, j, 1);
    distance += channelDistanceSq(rgba, previousFrame.bytes, i, j, 2);
    if (channels === 4) {
      distance += channelDistanceSq(rgba, previousFrame.bytes, i, j, 3);
    }

    if (distance > pixelThresholdSq) {
      changedPixels++;
      clearPixelError(errors, j, channels);
    }
  }

  const pixelCount = previousFrame.bytes.length / channels;
  if (
    pixelCount > 0 &&
    changedPixels / pixelCount >= temporal.changeDetection.sceneChangeRatio
  ) {
    errors.fill(0);
  }
}

function channelDistanceSq(
  rgba: RGBAInput,
  previous: Uint8Array,
  rgbaOffset: number,
  previousOffset: number,
  channel: number,
): number {
  const diff =
    byteAt(rgba, rgbaOffset + channel) -
    byteAt(previous, previousOffset + channel);
  return diff * diff;
}

function clearPixelError(
  errors: Float32Array,
  offset: number,
  channels: number,
): void {
  errors[offset] = 0;
  errors[offset + 1] = 0;
  errors[offset + 2] = 0;
  if (channels === 4) errors[offset + 3] = 0;
}

function copySourceFrame(
  destination: Uint8Array,
  rgba: RGBAInput,
  channels: number,
): void {
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += channels) {
    destination[j] = byteAt(rgba, i);
    destination[j + 1] = byteAt(rgba, i + 1);
    destination[j + 2] = byteAt(rgba, i + 2);
    if (channels === 4) destination[j + 3] = byteAt(rgba, i + 3);
  }
}
