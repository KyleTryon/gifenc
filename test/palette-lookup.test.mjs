import test from "node:test";
import assert from "node:assert/strict";
import { applyPalette } from "../dist/gifenc.mjs";

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
