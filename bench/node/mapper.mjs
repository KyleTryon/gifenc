// Run after build: node bench/node/mapper.mjs (requires ffmpeg).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  applyPalette,
  createPaletteMapper,
  quantize,
} from "../../dist/gifenc.mjs";

const width = 160;
const height = 90;
const frameBytes = width * height * 4;
const video = execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-i",
    "fixtures/video/basketball_5s_320p.mp4",
    "-vf",
    `fps=4,scale=${width}:${height}`,
    "-frames:v",
    "20",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ],
  { maxBuffer: frameBytes * 21 },
);
const videoFrames = Array.from(
  { length: Math.floor(video.length / frameBytes) },
  (_, i) => video.subarray(i * frameBytes, (i + 1) * frameBytes),
);
assert.equal(videoFrames.length, 20);
const lowFrames = videoFrames.map((frame, n) => {
  const result = Buffer.alloc(frame.length);
  for (let i = 0; i < frame.length; i += 4) {
    const c = (Math.floor(i / 4) + n * 13) % width < 80 ? 40 : 220;
    result[i] = c;
    result[i + 1] = c;
    result[i + 2] = c;
    result[i + 3] = 255;
  }
  return result;
});
for (const [name, frames] of [
  ["video", videoFrames],
  ["low-color", lowFrames],
]) {
  const palette = quantize(frames[0], 64, { format: "rgb444" });
  const expected = frames.map((frame) =>
    applyPalette(frame, palette, "rgb444"),
  );
  const cases = [
    [
      "applyPalette",
      () => frames.map((frame) => applyPalette(frame, palette, "rgb444")),
    ],
    ...[256, 262144].flatMap((cap) =>
      [false, true].map((reset) => {
        const mapper = createPaletteMapper(palette, {
          format: "rgb444",
          maxCacheEntries: cap,
        });
        return [
          `mapper cap=${cap} ${reset ? "reset each frame" : "retain"}`,
          () =>
            frames.map((frame) => {
              if (reset) mapper.reset();
              return mapper.map(frame);
            }),
        ];
      }),
    ),
  ];
  console.log(
    `\n${name}: ${frames.length} changing ${width}x${height} frames, ${palette.length}-color shared palette`,
  );
  for (const [label, run] of cases) {
    // First pass includes cold caches; following passes show repeated sequence behavior.
    const times = [];
    for (let pass = 0; pass < 4; pass++) {
      const start = performance.now();
      const actual = run();
      times.push(performance.now() - start);
      for (let i = 0; i < frames.length; i++)
        assert.deepEqual(actual[i], expected[i]);
    }
    console.log(
      `${label}: cold=${times[0].toFixed(1)}ms, subsequent=${times
        .slice(1)
        .map((t) => t.toFixed(1))
        .join("/")}ms`,
    );
  }
}
