# @techsquidtv/gifenc

A fork of [Matt DesLauriers' `gifenc`](https://github.com/mattdesl/gifenc)
with additional features, modernized, and ported to Typescript. AI assisted.

`@techsquidtv/gifenc` is a fast, lightweight JavaScript GIF encoder for Node.js,
browsers, and workers. It keeps the original low-level approach: you control
palette generation, palette application, and frame writing instead of handing
everything to a black-box encoder.

## Tribute

This project exists because of Matt DesLauriers' original `gifenc`, a tiny and
clever pure-JavaScript GIF encoder. The core API shape, stream encoder, and
performance-minded design come from that work.

This fork keeps that lineage visible while adding newer package tooling and
features under the `@techsquidtv/gifenc` npm scope.

## What's Different

- Published as `@techsquidtv/gifenc`.
- TypeScript source with generated declaration files.
- Modern package exports for ESM and CommonJS consumers.
- Floyd-Steinberg dithering support in `applyPalette`.
- Updated examples, benchmarks, development tooling, and release automation.

## Install

```sh
npm install @techsquidtv/gifenc
```

```js
import {
  GIFEncoder,
  quantize,
  applyPalette,
  createTemporalDither,
  createTemporalDitherSequence,
} from "@techsquidtv/gifenc";
```

For direct browser imports, use the ESM build:

```js
import {
  GIFEncoder,
  quantize,
  applyPalette,
  createTemporalDither,
  createTemporalDitherSequence,
} from "https://unpkg.com/@techsquidtv/gifenc/dist/gifenc.mjs";
```

## Quick Start

```js
import { GIFEncoder, quantize, applyPalette } from "@techsquidtv/gifenc";

const { data, width, height } = getImageDataSomehow();

const palette = quantize(data, 256);
const index = applyPalette(data, palette);

const gif = GIFEncoder();
gif.writeFrame(index, width, height, { palette });
gif.finish();

const bytes = gif.bytes();
```

For an animation, call `writeFrame` for each frame before `finish`:

```js
const gif = GIFEncoder();

for (const frame of frames) {
  const palette = quantize(frame.data, 256);
  const index = applyPalette(frame.data, palette);

  gif.writeFrame(index, frame.width, frame.height, {
    palette,
    delay: 100,
  });
}

gif.finish();
const bytes = gif.bytes();
```

## Animation timing

GIF delays have 10 ms resolution. Passing `1000 / fps` directly as each
`writeFrame` delay rounds every frame independently and can accumulate drift.
Use `frameDelay(startMs, endMs)` to round consecutive boundaries instead:

```js
import { frameDelay } from "@techsquidtv/gifenc";

const fps = 12;
const durationMs = 15000;
const frameCount = Math.ceil((durationMs * fps) / 1000);
for (let i = 0; i < frameCount; i++) {
  const start = (i * 1000) / fps;
  const end = Math.min(((i + 1) * 1000) / fps, durationMs);
  gif.writeFrame(indexedFrames[i], width, height, {
    palette: i === 0 ? palette : undefined,
    delay: frameDelay(start, end),
  });
}
```

Use boundaries relative to one sequence origin; the final boundary can be the
actual clip end, including a partial frame. With source timestamps, use each
retained frame's timestamp and the next retained timestamp as its boundaries,
then use the clip end for the last frame. If frames are skipped, this holds the
preceding retained frame over the gap; intentionally removing time instead
requires a new contiguous output timeline. Each interval and resulting delay
must fit the encoder's per-frame limit (655350 ms); split longer holds into
multiple frames. Zero delays can occur for short intervals, and viewers may
clamp them or apply their own playback timing. The helper preserves total
encoded duration to the nearest 10 ms, not necessarily actual viewer timing.

For Cliparr, after a gifenc release containing this helper, replace the repeated
`1000 / frameRate` delay with boundaries computed from output frame indices and
the clip duration, or from retained frame timestamps as above. Keep a partial
last frame and account for skipped frames according to the intended timeline.
The low-level `writeFrame` delay contract remains unchanged.

## Dithering

Use Floyd-Steinberg dithering when mapping RGBA pixels to a reduced palette. This
can help gradients, photographs, and other continuous-tone images avoid obvious
banding.

```js
const format = "rgb565";
const palette = quantize(data, 256, { format });
const index = applyPalette(data, palette, {
  format,
  dither: "floyd-steinberg",
  width,
  height,
});
```

You can also tune the dither pass:

```js
const index = applyPalette(data, palette, {
  dither: "floyd-steinberg",
  width,
  height,
  ditherStrength: 0.75,
  serpentine: true,
});
```

For animations, temporal dithering stabilizes colors between frames. Plain
error diffusion re-dithers every frame from scratch, so small source changes
(video noise, a new palette) ripple through the pattern and static areas
shimmer. With temporal dithering, a pixel whose source barely changed keeps its
previous color when that color is almost as close as the best match, and
spatial diffusion absorbs the small difference. Create one state object per
animation and reuse it while mapping frames:

```js
const temporalDither = createTemporalDither({ width, height, format });

for (const frame of frames) {
  const palette = quantize(frame.data, 256, { format });
  const index = applyPalette(frame.data, palette, {
    format,
    dither: "floyd-steinberg",
    temporalDither,
  });

  gif.writeFrame(index, width, height, { palette, delay });
}
```

Temporal dithering state is mutable and sequence-scoped. Do not share one state
between unrelated animations or concurrent encodes; create separate states, or
call `reset()` before reusing a state for a new sequence.

On a 12 fps, 128-color video clip this reduced frame-to-frame change in static
regions by about 35% compared with Floyd-Steinberg alone, with a ~2% larger
file and nearly unchanged color accuracy. It also works without spatial
dithering (`dither: false`), where it acts as hysteresis against palette churn.

By default, temporal dithering also uses change detection to reject stale
history across large motion or scene changes. Pixels whose source changed
sharply ignore their history, and the whole history is dropped when most of the
frame changes:

```js
const temporalDither = createTemporalDither({
  width,
  height,
  format,
  changeDetection: {
    pixelThreshold: 48,
    sceneChangeRatio: 0.75,
  },
});
```

Set `changeDetection: false` to let every pixel consider its history (the
closeness test still applies) or if you prefer to call `reset()` manually at
known cuts. Per-frame palettes are supported: previous colors are matched into
the current palette each frame.

## API

### `quantize(rgba, maxColors, options)`

Builds a reduced color palette from RGBA pixel data.

- `rgba`: `Uint8Array` or `Uint8ClampedArray` containing RGBA pixels.
- `maxColors`: maximum palette size, usually `256` or less.
- `options.format`: `"rgb565"`, `"rgb444"`, or `"rgba4444"`.
- `options.oneBitAlpha`: converts alpha to fully transparent or fully opaque.
- `options.clearAlpha`: clears RGB channels for transparent colors.

Returns a palette such as:

```js
[
  [0, 255, 10],
  [50, 20, 100],
];
```

### `createPaletteSampler(maxSamples, samplesPerFrame)`

Build a shared palette from caller-selected RGBA frames without retaining or
concatenating the full frames:

```js
const sampler = createPaletteSampler(120_000, 5_000);
for (const frame of selectedFrames) sampler.addFrame(frame?.data);
const palette = sampler.quantize(256, { format: "rgb565" });
```

The sampler owns a fixed `maxSamples * 4` byte buffer. It samples at most
`samplesPerFrame` pixels across each complete frame, varying sample positions
within strata to reduce regular-pattern aliasing. Sampling is deterministic, but
cannot guarantee representation of every color. Missing and empty frames add
nothing; a full sampler ignores later frames. Select frames and divide the budget
among them in the caller to avoid favoring early frames. `addFrame` returns the
number of pixels added. `quantize` accepts the same options and returns the same
RGB or RGBA palette format as `quantize`; it returns `[]` if no pixels were added.
Input is RGBA byte data, including for RGB palette formats.

### `applyPalette(rgba, palette, options)`

Maps RGBA pixels to palette indexes.

- `rgba`: source RGBA pixel data.
- `palette`: palette returned by `quantize` or supplied by your app.
- `options`: either a format string or an options object.
- `options.dither`: `false`, `true`, or `"floyd-steinberg"`.
- `options.width`: required when dithering is enabled.
- `options.height`: optional consistency check for dithered input.
- `options.ditherStrength`: scales propagated quantization error.
- `options.serpentine`: alternates scan direction per row.
- `options.temporalDither`: state returned by `createTemporalDither()`.

With `"rgba4444"`, a fully transparent pixel maps to the palette's nearest fully
transparent entry when there is one, since its RGB is invisible (`quantize`
clears transparent entries' RGB by default). When dithering, a pixel mapped to a
fully transparent entry diffuses only its alpha error, not its invisible RGB.

Returns a `Uint8Array` with one palette index per pixel.

### `createPaletteMapper(palette, options)`

Use a reusable mapper when animation frames share a palette:

```js
const mapper = createPaletteMapper(palette, { format: "rgb565" });
const index = mapper.map(frame.data);
```

The mapper snapshots the palette at construction, caches complete source colors,
and produces the same indexes as `applyPalette`. It supports RGB and RGBA formats
without spatial or temporal dithering. Later mutations of the original palette
do not affect the snapshot; create a new mapper to use a new palette.

`maxCacheEntries` defaults to `262144` and must be a positive safe integer. A full
cache is cleared before inserting another color, bounding memory across long
animations. Call `reset()` to release cached entries while keeping the snapshot.
Cache eviction and reset affect speed only. Larger limits can improve repeated
high-color frames at the cost of retained memory. Measure on your own frames:
changing colors, a small cache, or low-color input can erase the benefit. Run
`pnpm run build:esm && node bench/node/mapper.mjs` (requires ffmpeg) for a
multi-frame comparison, including exact index checks and cache resets.

For a shared-palette animation, quantize a representative sample once, then
construct one mapper per worker and palette and reuse it for that worker's frames.
Use [`shared-palette-worker.js`](./examples/browser/shared-palette-worker.js)
with the existing worker pool by passing
`workerUrl: "/examples/browser/shared-palette-worker.js"`. It uses the same
initialization, cumulative per-frame delays, transferable chunk messages, and
ordered assembly as the default worker. The first frame assigned to each worker
initializes its mapper; subsequent frames reuse it with the same global palette.
The example pool derives that palette from frame zero. Application pipelines can
use `createPaletteSampler` to build representative shared palettes. Start a new
worker job when the palette changes. For spatial or temporal dithering, use
`applyPalette` with its dithering options instead.

Cliparr users: the installed 1.1.0 release does not contain this API. After a
release containing it is available, upgrade to that release and use the shared
palette mapper for Compact's non-dithered frames, initialized once per worker.
Keep the existing dithering path for presets that use temporal history or change
palettes; validate output and benchmark with representative clips.

### `createTemporalDitherSequence()`

Manages one ordered animation at a time using the same state as
`createTemporalDither`. Start each animation with its dimensions and settings:

```js
const sequence = createTemporalDitherSequence();
const temporalDither = sequence.start({ width, height, format });
try {
  for (const frame of frames) {
    const index = applyPalette(frame.data, palette, {
      width,
      height,
      format,
      temporalDither,
    });
    gif.writeFrame(index, width, height, { palette, delay });
  }
} finally {
  sequence.end();
}
```

Process frames sequentially in display order, with one frame in flight. Use a
separate sequence for each concurrent animation. Call `reset()` at a known cut;
it requires an active sequence. `end()` clears and releases the active state and
is safe to repeat. Call `start()` again for a new animation or when dimensions,
format, or temporal settings change. Starting successfully clears the previous
state; invalid options leave it active. Do not use a state returned by an earlier
`start()` after replacement or `end()`: retained references cannot be revoked.
The direct `createTemporalDither()` API remains available.

For Cliparr, create a sequence per encoding job, start it once using the job's
resolved dimensions, format and temporal settings, pass the returned state to
ordered frame mappings, and end it in a `finally` block. Keep spatial-temporal
jobs on one worker with one frame in flight. Remove the settings-key cache and
restart the sequence if those settings change. This requires a gifenc release
containing this API before upgrading Cliparr.

### `createTemporalDither(options)`

Creates resettable temporal dithering state for an animation.

- `options.width`: frame width in pixels.
- `options.height`: frame height in pixels.
- `options.format`: `"rgb565"`, `"rgb444"`, or `"rgba4444"`.
- `options.strength`: how strongly static pixels keep their previous color.
  Defaults to `1`: a previous color is kept when it is no worse than the best
  match by more than 12% of the distance between the two colors. Higher values
  are steadier but noisier; `0` only breaks exact ties.
- `options.decay`, `options.maxError`: deprecated and ignored. They configured
  the earlier error-carrying algorithm, which increased flicker and file size.
- `options.changeDetection`: ignores temporal history after large source
  changes. Defaults to `true`, with `pixelThreshold: 48` and
  `sceneChangeRatio: 0.75`.

Call `state.reset()` before reusing the state for an unrelated animation, or at
known scene boundaries when managing cuts yourself.

### `GIFEncoder(options)`

Creates an encoder stream.

- `options.auto`: when `true`, writes the GIF header and first-frame metadata on
  the first frame.
- `options.initialCapacity`: starting internal buffer size.

Common methods:

- `writeFrame(index, width, height, options)`: writes one indexed frame.
- `finish()`: writes the GIF trailer.
- `bytes()`: returns a copied `Uint8Array`.
- `bytesView()`: returns a direct view into the encoder buffer.
- `takeBytes()`: releases the output buffer and resets frame state, returning a
  transferable view without copying the written bytes.
- `writeHeader()`: writes a header manually when `auto` is disabled.
- `reset()`: reuses the encoder buffer for another GIF.

`bytes()` is an independent exact-sized copy. `bytesView()` and `buffer` refer
to encoder-owned storage: writing, growing, or resetting can invalidate the
view or change its contents. Do not transfer that storage while the encoder
uses it. `reset()` retains output capacity and compression workspace; views
from before reset can be overwritten by later writes.

`takeBytes()` transfers ownership of the output storage to the caller and
resets the encoder as if for a new GIF. It retains the compression workspace,
but allocates new output storage on subsequent writes. The returned view starts
at offset zero and its `byteLength` is the written length; its `buffer` can be
larger, with unused bytes zeroed. Transfer the view together with its buffer,
not the buffer alone as if its whole capacity were GIF data. Earlier views of
the released storage still alias it and are detached if its buffer is
transferred. Finish a complete GIF before taking it; manual chunks need no
trailer until assembly. The low-level `stream.takeBytes()` only resets the
stream, not the encoder's frame state.

For example, a worker can retain one encoder per encoding mode and transfer
each result without copying it:

```js
const encoder = GIFEncoder(); // keep in the worker, outside the message handler
// For each independent GIF: write frames and call finish().
const bytes = encoder.takeBytes();
postMessage({ bytes }, [bytes.buffer]);
// The receiver uses bytes.byteOffset and bytes.byteLength; the worker can
// immediately write a new GIF with encoder.
```

Cliparr can adopt this after a release by retaining suitable worker encoders,
returning `takeBytes()` from frame encoding, and changing the worker message
and receiver to carry the typed-array view (including its length) while
transferring `bytes.buffer`. This removes both the `bytes()` copy and the
worker's extra ArrayBuffer copy. Preserve the existing framing and palette
rules; resetting an encoder does not supply a prior chunk's global palette.
For final assembly, an owned view can likewise be passed to `Blob` directly;
Blob construction may itself copy according to the platform.

The low-level `stream.writeBytes(data, offset, byteLength)` and
`stream.writeBytesView(data, offset, byteLength)` methods default `byteLength` to
the remaining source after `offset`. Offsets and lengths must be nonnegative
integers within the source; invalid ranges throw `RangeError` before writing.
Calls that previously passed out-of-bounds ranges must use valid ranges; they
now throw instead of truncating, appending unwritten bytes, or partially writing.

Frame options include:

- `palette`: color table for the frame.
- `delay`: frame delay in milliseconds.
- `repeat`: animation repeat count, where `0` means forever.
- `transparent`: enables one-bit transparency.
- `transparentIndex`: palette index to treat as transparent.
- `dispose`: GIF disposal method override.
- `colorDepth`: integer from `1` to `8`, large enough for the active palette. By default, compression uses the minimum depth for the active palette (at least 2 bits for GIF LZW), while the logical screen color resolution remains 8 bits. An explicit value also sets the logical screen color resolution on the first frame.

Dimensions must be integers from `1` to `65535`. Later frames must fit within
the first frame's logical screen. Every pixel index, and an enabled transparent
index, must reference an entry in the frame's local palette or the global palette.
Manual worker chunks must supply a local palette when they do not initialize or
already have a global palette. Invalid frames throw before modifying the stream.

### Correctness changes

**Breaking changes:** fractional and overflowing dimensions, out-of-palette
indexes, and insufficient color depths are rejected. RGB565 now preserves six
green bits, RGBA clustering considers alpha, and palette lookup caches complete
source colors. Generated palettes and GIF bytes can therefore differ from earlier
versions. `prequantize` clamps rounded channels instead of wrapping, and a numeric
one-bit alpha threshold of `0` is honored.

### Color Helpers

- `nearestColorIndex(palette, pixel)`: returns the closest palette index.
- `nearestColorIndexWithDistance(palette, pixel)`: returns
  `[index, distance]`.
- `prequantize(rgba, options)`: reduces RGBA precision before quantization.

## Web Workers

`gifenc` works well in workers because quantization, palette mapping, and frame
encoding can be split across frames.

A common pattern:

- Send RGBA frame data to workers.
- Share the global palette with every worker; map pixels with `applyPalette`.
- Call `encodeFrameChunk` with `sequenceIndex` and `globalPalette`.
  The first frame uses that palette; later frames may supply a local `palette`.
- Return encoded frame chunks to the main thread.
- Call `assembleFrameChunks(chunks, encodedFrameCount)` once all frames arrive. It orders chunks and
  rejects missing, duplicate, or inconsistent sequence and palette context.

Chunks are serializable worker messages; transfer `chunk.bytes.buffer` and treat
chunk metadata and bytes as immutable trusted output from `encodeFrameChunk`.
For Cliparr Compact exports, after a gifenc release containing this API, pass
the same global palette to every frame chunk and omit `palette` on later frames.
Assign dense sequence indexes only to frames successfully read, then pass the final
encoded frame count to assembly after all work completes.
Assemble the returned chunks instead of concatenating manual encoder streams.
Per-frame palette exports can pass each later frame’s palette as `palette`.

See the local worker example:

- [`examples/browser/encode-workers.html`](./examples/browser/encode-workers.html)
- [`examples/browser/worker.js`](./examples/browser/worker.js)

## How GIF Encoding Works

GIF encoding usually has three steps:

1. Quantize RGBA pixels into a palette of 256 colors or fewer.
2. Map each RGBA pixel to the nearest palette index.
3. Write indexed frames and palettes into a GIF stream.

This package exposes all three steps so you can make tradeoffs per project: use
one palette for an entire animation, quantize each frame independently, enable
dithering for gradients, or skip quantization entirely if your input is already
indexed.

## Examples

Node examples:

```sh
pnpm run build
node examples/node/encode.ts
node examples/node/encode-dither.ts
```

Browser examples:

```sh
pnpm run build
pnpm run serve
```

Then open:

- [http://localhost:5000/examples/browser/](http://localhost:5000/examples/browser/)
- [http://localhost:5000/examples/browser/encode-workers.html](http://localhost:5000/examples/browser/encode-workers.html)
- [http://localhost:5000/bench/browser/](http://localhost:5000/bench/browser/)
- [http://localhost:5000/bench/video-report/](http://localhost:5000/bench/video-report/)

The video GIF benchmark report can also be published manually to GitHub Pages
from the `Benchmark Pages` workflow. The hosted report remains browser-based:
visitors click `Run benchmark`, and their browser decodes the MP4 and encodes
the GIF variants. Once deployed, open:

- [https://kyletryon.github.io/gifenc/bench/video-report/](https://kyletryon.github.io/gifenc/bench/video-report/)

## Development

Use Node.js 26.13.0 LTS with pnpm 12.18.0 for local development. The tooling supports
Node.js 22.13.0 and newer.

Tooling migration: this repository now requires pnpm 12 instead of pnpm 11 and
uses Node.js 26 LTS by default. Install the pinned tools before developing. The
published encoder API and minimum supported Node.js version are unchanged.

```sh
pnpm install
pnpm run build
pnpm run check
```

Useful scripts:

- `pnpm run build`: builds ESM, CommonJS, and types into `dist`.
- `pnpm run build:benchmark-pages`: builds the static GitHub Pages benchmark
  artifact into `_site`.
- `pnpm run check`: runs formatting, linting, type checks, and dependency checks.
- `pnpm run test:package`: checks the built npm archive with ESM, CommonJS, and
  TypeScript consumers.
- `pnpm run serve`: starts the local example server.

## Publishing

This fork publishes publicly to npm as `@techsquidtv/gifenc`. Releases are
intended to be created through the GitHub release workflow so version bumps,
tags, generated release notes, and npm publishing stay together.

The release workflow determines the version bump from commits since the latest
`v*` tag. Breaking-change markers create a major release, `feat` commits create
a minor release, and `fix`, `perf`, or `security` commits create a patch
release.

Pull requests and pushes to `main` run the full checks, package-consumer smoke
tests, and benchmark-site build on Ubuntu 26.04 with Node.js 22.13.0, 24, and 26.
CI also audits development dependencies. TypeScript stays on 6.0.3 because the
latest stable `typescript-eslint` supports TypeScript versions below 6.1. The
Dependabot major version exclusion can be removed once the lint tooling supports
TypeScript 7.

Releases require that validation matrix to pass, validate the bumped package,
and publish the checked archive before atomically pushing the release commit and
tag. The workflow uses npm trusted publishing; configure this repository and
`release.yml` as the package's trusted publisher on npm.

If publication succeeds but pushing fails, dispatch the workflow again from
unchanged `main`. It resumes only when the existing npm version's integrity
matches the rebuilt archive. A version with different contents stops the release
for investigation. If pushing succeeds but release-note creation fails, dispatch
again from `main` to recover the missing GitHub release. If `main` advances during
publication, reconcile the published version before attempting another release;
npm publication cannot be rolled back.

## Credits

Created from [Matt DesLauriers' `gifenc`](https://github.com/mattdesl/gifenc).
Thank you to Matt for the original encoder and API design.

This project also builds on ideas and prior art from:

- [GIF.js](https://jnordberg.github.io/gif.js/)
- [gif-codec](https://github.com/potomak/gif-codec)
- [PnnQuant.js](https://github.com/mcychan/PnnQuant.js)

## License

MIT. See [LICENSE.md](./LICENSE.md).
