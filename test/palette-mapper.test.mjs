import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPalette,
  createPaletteMapper,
  createTemporalDither,
} from "../dist/gifenc.mjs";

for (const format of ["rgb444", "rgb565", "rgba4444"]) {
  test(`${format} reusable cache remains exact across frames, eviction, and reset`, () => {
    const colors =
      format === "rgba4444"
        ? [
            [0, 0, 0, 0],
            [0, 0, 0, 7],
            [0, 0, 0, 15],
          ]
        : [
            [0, 0, 0, 255],
            [7, 0, 0, 255],
            [15, 0, 0, 255],
          ];
    const palette = colors.map((color) =>
      format === "rgba4444" ? [...color] : color.slice(0, 3),
    );
    for (const maxCacheEntries of [1, 2, 262144]) {
      const mapper = createPaletteMapper(palette, { format, maxCacheEntries });
      for (let frame = 0; frame < 9; frame++) {
        const rgba = new Uint8ClampedArray(
          [
            colors[frame % 3],
            colors[(frame + 1) % 3],
            colors[frame % 3],
          ].flat(),
        );
        assert.deepEqual(mapper.map(rgba), applyPalette(rgba, palette, format));
        if (frame % 2 === 0) mapper.reset();
      }
    }
  });
}

test("mapper snapshots palette channels and reset preserves that snapshot", () => {
  const palette = [
    [0, 0, 0],
    [255, 255, 255],
  ];
  const mapper = createPaletteMapper(palette);
  const pixels = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  palette[0][0] = 255;
  palette.reverse();
  palette.push([1, 2, 3]);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(Array.from(mapper.map(pixels)), [0, 1]);
    mapper.reset();
  }
});

test("mapper validates palettes, cache limits, options, and each source frame", () => {
  const palette = [
    [0, 0, 0],
    [255, 255, 255],
  ];
  for (const maxCacheEntries of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => createPaletteMapper(palette, { maxCacheEntries }),
      /maxCacheEntries/,
    );
  }
  assert.throws(() => createPaletteMapper([]), /palette/);
  assert.throws(() => createPaletteMapper(palette, "rgba4444"), /RGBA/);
  assert.throws(
    () => createPaletteMapper(palette, { dither: true, width: 1 }),
    /dithering/,
  );
  assert.throws(
    () =>
      createPaletteMapper(palette, {
        temporalDither: createTemporalDither({ width: 1, height: 1 }),
      }),
    /dithering/,
  );
  const mapper = createPaletteMapper(palette);
  assert.throws(() => mapper.map([]), /RGBA Uint8Array/);
  assert.throws(() => mapper.map(new Uint8Array(3)), /divide by 4/);
  assert.throws(
    () => mapper.map(new Uint8Array(new ArrayBuffer(8), 1, 4)),
    /4-byte boundary/,
  );
  assert.deepEqual(mapper.map(new Uint8Array()), new Uint8Array());
});
