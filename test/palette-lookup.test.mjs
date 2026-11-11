import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPalette,
  createPaletteMapper,
  quantize,
} from "../dist/gifenc.mjs";

for (const format of ["rgb444", "rgb565", "rgba4444"]) {
  test(`${format} optimized lookup matches exhaustive distances including ties`, () => {
    let seed = 123456789;
    const byte = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed & 255;
    };
    const channels = format === "rgba4444" ? 4 : 3;
    const palette = Array.from({ length: 255 }, () =>
      Array.from({ length: channels }, byte),
    );
    palette.push([...palette[0]]);
    const pixels = new Uint8Array(512 * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = byte();
    pixels.set([...palette[0].slice(0, 3), palette[0][3] ?? 255]);
    const expected = Array.from({ length: 512 }, (_, i) => {
      let nearest = 0,
        distance = Infinity;
      for (let j = 0; j < palette.length; j++) {
        let next = 0;
        for (let c = 0; c < channels; c++)
          next += (pixels[i * 4 + c] - palette[j][c]) ** 2;
        if (next <= distance) {
          distance = next;
          nearest = j;
        }
      }
      return nearest;
    });
    assert.equal(expected[0], 255);
    assert.deepEqual(
      Array.from(applyPalette(pixels, palette, format)),
      expected,
    );
    assert.deepEqual(
      Array.from(
        applyPalette(pixels, palette, {
          format,
          dither: true,
          width: 512,
          height: 1,
          ditherStrength: 0,
        }),
      ),
      expected,
    );
  });
}

test("rgba4444 maps fully transparent pixels to a transparent entry", () => {
  const pixels = new Uint8Array([
    255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255, 255, 0, 0, 0, 255,
  ]);
  const palette = quantize(pixels, 16, { format: "rgba4444" });
  assert.deepEqual(palette, [
    [0, 0, 0, 0],
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ]);

  for (const options of [
    "rgba4444",
    { format: "rgba4444", dither: true, width: 2 },
  ]) {
    assert.deepEqual(
      Array.from(applyPalette(pixels, palette, options)),
      [0, 0, 2, 1],
    );
  }
  assert.deepEqual(
    Array.from(
      createPaletteMapper(palette, { format: "rgba4444" }).map(pixels),
    ),
    [0, 0, 2, 1],
  );
});

test("rgba4444 picks the nearest of several transparent entries by RGB", () => {
  const palette = [
    [200, 0, 0, 0],
    [255, 255, 255, 255],
    [250, 250, 250, 0],
  ];
  const pixels = new Uint8Array([255, 255, 255, 0, 210, 0, 0, 0]);
  assert.deepEqual(
    Array.from(applyPalette(pixels, palette, "rgba4444")),
    [2, 0],
  );
});

test("lookup matches a linear scan for skewed and tie-heavy palettes", () => {
  let seed = 42;
  const byte = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
  const palettes = [
    // One channel varies: the sort must still lead on a useful channel.
    Array.from({ length: 64 }, (_, i) => [128, i * 4, 128]),
    Array.from({ length: 64 }, (_, i) => [128, 128, i * 4, 255]),
    // Many exact duplicates and equal distances.
    Array.from({ length: 40 }, (_, i) => [(i % 5) * 60, (i % 5) * 60, 0]),
    Array.from({ length: 7 }, () => [100, 100, 100]),
    [[3, 4, 5]],
  ];
  for (const palette of palettes) {
    const channels = palette[0].length;
    const format = channels === 4 ? "rgba4444" : "rgb565";
    const pixels = new Uint8Array(1024 * 4);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = i % 4 === 3 ? 255 : byte();
    }
    const expected = Array.from({ length: 1024 }, (_, i) => {
      let nearest = 0;
      let distance = Infinity;
      palette.forEach((color, j) => {
        let next = 0;
        for (let c = 0; c < channels; c++) {
          next += (pixels[i * 4 + c] - color[c]) ** 2;
        }
        if (next <= distance) {
          distance = next;
          nearest = j;
        }
      });
      return nearest;
    });
    assert.deepEqual(
      Array.from(applyPalette(pixels, palette, format)),
      expected,
    );
  }
});
