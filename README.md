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
} from "@techsquidtv/gifenc";
```

For direct browser imports, use the ESM build:

```js
import {
  GIFEncoder,
  quantize,
  applyPalette,
  createTemporalDither,
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

For animations, temporal dithering can carry each pixel's quantization error
into the next frame. Create one state object per animation and reuse it while
mapping frames:

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

By default, temporal dithering also uses change detection to reject stale
history across large motion or scene changes. This clears carried error for
changed pixels, and resets the whole history when most of the frame changes:

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

Set `changeDetection: false` if you want exact residual carry between every
frame or prefer to call `reset()` manually at known cuts.

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

Returns a `Uint8Array` with one palette index per pixel.

### `createTemporalDither(options)`

Creates resettable temporal dithering state for an animation.

- `options.width`: frame width in pixels.
- `options.height`: frame height in pixels.
- `options.format`: `"rgb565"`, `"rgb444"`, or `"rgba4444"`.
- `options.strength`: scales previous-frame carried error.
- `options.decay`: scales newly carried error for the next frame.
- `options.maxError`: clamps carried per-channel error.
- `options.changeDetection`: rejects stale temporal history after large source
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
- `writeHeader()`: writes a header manually when `auto` is disabled.
- `reset()`: reuses the encoder buffer for another GIF.

Frame options include:

- `palette`: color table for the frame.
- `delay`: frame delay in milliseconds.
- `repeat`: animation repeat count, where `0` means forever.
- `transparent`: enables one-bit transparency.
- `transparentIndex`: palette index to treat as transparent.
- `dispose`: GIF disposal method override.

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
- In each worker, call `quantize`, `applyPalette`, and `GIFEncoder`.
- Return encoded frame chunks to the main thread.
- Combine chunks into one final GIF stream.

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

Use Node.js 24.16.0 LTS with pnpm 11 for local development. The tooling supports
Node.js 22.13.0 and newer.

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
- `pnpm run serve`: starts the local example server.

## Publishing

This fork publishes publicly to npm as `@techsquidtv/gifenc`. Releases are
intended to be created through the GitHub release workflow so version bumps,
tags, generated release notes, and npm publishing stay together.

The release workflow determines the version bump from commits since the latest
`v*` tag. Breaking-change markers create a major release, `feat` commits create
a minor release, and `fix`, `perf`, or `security` commits create a patch
release.

## Credits

Created from [Matt DesLauriers' `gifenc`](https://github.com/mattdesl/gifenc).
Thank you to Matt for the original encoder and API design.

This project also builds on ideas and prior art from:

- [GIF.js](https://jnordberg.github.io/gif.js/)
- [gif-codec](https://github.com/potomak/gif-codec)
- [PnnQuant.js](https://github.com/mcychan/PnnQuant.js)

## License

MIT. See [LICENSE.md](./LICENSE.md).
