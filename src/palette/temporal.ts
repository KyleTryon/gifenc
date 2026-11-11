import { normalizeFormat } from "../validation.js";
import { alpha, blue, byteAt, colorAt, green, red } from "./utils.js";
import type {
  Format,
  Palette,
  RGBAInput,
  TemporalDitherOptions,
  TemporalDitherSequence,
  TemporalDitherState,
} from "../types.js";

const DEFAULT_STRENGTH = 1;
const DEFAULT_DECAY = 0.75;
const DEFAULT_MAX_ERROR = 128;
const DEFAULT_CHANGE_PIXEL_THRESHOLD = 48;
const DEFAULT_SCENE_CHANGE_RATIO = 0.75;
/**
 * How much worse than the best match the previous frame's color may be, per
 * unit of strength, as a fraction of the distance between the two colors.
 * Spatial diffusion absorbs the difference, so small values remove most
 * frame-to-frame dither churn while barely changing local average color.
 * Measuring relative to the colors' separation keeps the effect consistent
 * across dense and sparse palettes.
 */
const TOLERANCE_PER_STRENGTH = 0.12;

const histories = new WeakMap<TemporalDither, History>();

type ChangeDetection = {
  readonly pixelThreshold: number;
  readonly sceneChangeRatio: number;
};

type History = {
  /** Palette index chosen for each pixel in the previous frame. */
  readonly indexes: Uint8Array;
  /** Previous source pixels, used for change detection. */
  readonly source: Uint8Array;
  /** Previous palette as packed RGBA bytes. */
  readonly palette: Uint8Array;
  paletteLength: number;
  hasFrame: boolean;
};

/**
 * Per-frame view of temporal history used by the dithering loop.
 *
 * `remap` maps each previous palette index to the nearest entry of the current
 * palette, so history survives per-frame palettes. `remap` is `null` when there
 * is no usable history (first frame, after reset, or after a scene change).
 */
export type TemporalFrame = {
  readonly indexes: Uint8Array;
  readonly source: Uint8Array;
  readonly remap: Uint8Array | null;
  readonly channels: 3 | 4;
  /** Squared source distance above which a pixel ignores its history. */
  readonly pixelThresholdSq: number;
  /** Allowed extra distance as a fraction of the candidates' separation. */
  readonly tolerance: number;
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
    // Validated and exposed only for compatibility with the earlier
    // error-carrying algorithm; neither affects output.
    /* eslint-disable @typescript-eslint/no-deprecated */
    this.decay = normalizeUnit(options.decay, DEFAULT_DECAY, "decay");
    this.maxError = normalizeNonNegative(
      options.maxError,
      DEFAULT_MAX_ERROR,
      "maxError",
    );
    /* eslint-enable @typescript-eslint/no-deprecated */
    this.changeDetection = normalizeChangeDetection(options.changeDetection);

    const pixels = this.width * this.height;
    histories.set(this, {
      indexes: new Uint8Array(pixels),
      source: new Uint8Array(
        this.changeDetection ? pixels * temporalDitherChannels(this.format) : 0,
      ),
      palette: new Uint8Array(256 * 4),
      paletteLength: 0,
      hasFrame: false,
    });
  }

  reset(): void {
    const history = histories.get(this);
    if (history) history.hasFrame = false;
  }
}

export function createTemporalDither(
  options: TemporalDitherOptions,
): TemporalDitherState {
  return new TemporalDither(options);
}

/** Manage temporal history across explicitly bounded animation sequences. */
export function createTemporalDitherSequence(): TemporalDitherSequence {
  let state: TemporalDitherState | undefined;
  return {
    start(options) {
      const next = createTemporalDither(options);
      state?.reset();
      state = next;
      return next;
    },
    reset() {
      if (!state)
        throw new Error("Temporal dither sequence has not been started");
      state.reset();
    },
    end() {
      state?.reset();
      state = undefined;
    },
  };
}

export function temporalDitherChannels(format: Format): 3 | 4 {
  return format === "rgba4444" ? 4 : 3;
}

function getHistory(
  state: TemporalDitherState,
  format: Format,
  width: number,
  height: number,
  functionName: string,
): History {
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

  const history = histories.get(state);
  if (!history) {
    throw new Error(
      `${functionName}() received an invalid temporalDither state`,
    );
  }
  return history;
}

/**
 * Validate the state and resolve how the previous frame applies to this one.
 * The caller must write every pixel's chosen index into `frame.indexes`, then
 * call {@link commitTemporalFrame}.
 */
export function beginTemporalFrame(
  state: TemporalDitherState,
  rgba: RGBAInput,
  format: Format,
  width: number,
  height: number,
  nearest: (r: number, g: number, b: number, a?: number) => number,
  functionName: string,
): TemporalFrame {
  const history = getHistory(state, format, width, height, functionName);
  const channels = temporalDitherChannels(format);
  const changeDetection = state.changeDetection;
  const pixelThresholdSq = changeDetection
    ? changeDetection.pixelThreshold * changeDetection.pixelThreshold
    : Infinity;

  let remap: Uint8Array | null = null;
  if (
    history.hasFrame &&
    !(
      changeDetection && isSceneChange(history, rgba, channels, changeDetection)
    )
  ) {
    remap = new Uint8Array(history.paletteLength);
    const previous = history.palette;
    for (let i = 0, j = 0; i < remap.length; i++, j += 4) {
      remap[i] = nearest(
        previous[j] ?? 0,
        previous[j + 1] ?? 0,
        previous[j + 2] ?? 0,
        previous[j + 3] ?? 0xff,
      );
    }
  }

  return {
    indexes: history.indexes,
    source: history.source,
    remap,
    channels,
    pixelThresholdSq,
    tolerance: state.strength * TOLERANCE_PER_STRENGTH,
  };
}

/** Record this frame's source and palette as history for the next frame. */
export function commitTemporalFrame(
  state: TemporalDitherState,
  rgba: RGBAInput,
  palette: Palette,
  format: Format,
  width: number,
  height: number,
  functionName: string,
): void {
  const history = getHistory(state, format, width, height, functionName);
  if (state.changeDetection) {
    copySourceFrame(history.source, rgba, temporalDitherChannels(format));
  }
  const length = Math.min(256, palette.length);
  for (let i = 0, j = 0; i < length; i++, j += 4) {
    const color = colorAt(palette, i);
    history.palette[j] = red(color);
    history.palette[j + 1] = green(color);
    history.palette[j + 2] = blue(color);
    history.palette[j + 3] = alpha(color);
  }
  history.paletteLength = length;
  history.hasFrame = true;
}

function isSceneChange(
  history: History,
  rgba: RGBAInput,
  channels: 3 | 4,
  changeDetection: ChangeDetection,
): boolean {
  const pixelCount = rgba.length / 4;
  if (pixelCount === 0) return false;
  const thresholdSq =
    changeDetection.pixelThreshold * changeDetection.pixelThreshold;
  const limit = changeDetection.sceneChangeRatio * pixelCount;
  const previous = history.source;
  let changed = 0;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += channels) {
    if (
      sourceDistanceSq(rgba, i, previous, j, channels) > thresholdSq &&
      ++changed >= limit
    ) {
      return true;
    }
  }
  return changed >= limit;
}

export function sourceDistanceSq(
  rgba: RGBAInput,
  rgbaOffset: number,
  previous: Uint8Array,
  previousOffset: number,
  channels: 3 | 4,
): number {
  const dr = byteAt(rgba, rgbaOffset) - (previous[previousOffset] ?? 0);
  const dg = byteAt(rgba, rgbaOffset + 1) - (previous[previousOffset + 1] ?? 0);
  const db = byteAt(rgba, rgbaOffset + 2) - (previous[previousOffset + 2] ?? 0);
  let distance = dr * dr + dg * dg + db * db;
  if (channels === 4) {
    const da =
      byteAt(rgba, rgbaOffset + 3) - (previous[previousOffset + 3] ?? 0);
    distance += da * da;
  }
  return distance;
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
