import {
  GIFEncoder,
  applyPalette,
  nearestColorIndex,
  nearestColorIndexWithDistance,
  quantize,
  type ApplyPaletteOptions,
  type Color,
  type Palette,
  type RGB,
  type RGBA,
} from "../../src/index.js";

const rgbaData = new Uint8Array([0, 0, 0, 255]);
const rgb: RGB = [0, 128, 255];
const rgba: RGBA = [0, 128, 255, 64];
const color: Color = rgba;
const palette: Palette = [rgb, rgba, color];

const quantized: Palette = quantize(rgbaData, 2, { format: "rgba4444" });
const indexed = applyPalette(rgbaData, palette, {
  format: "rgb565",
  dither: "floyd-steinberg",
  width: 1,
  height: 1,
});
const paletteOptions: ApplyPaletteOptions = {
  dither: true,
  width: 1,
  height: 1,
};

applyPalette(rgbaData, quantized, paletteOptions);
GIFEncoder().writeFrame(indexed, 1, 1, { palette: [rgb] });

const nearestIndex: number = nearestColorIndex(palette, rgb);
const nearestWithDistance: [number, number] = nearestColorIndexWithDistance(
  palette,
  rgba,
);

void nearestIndex;
void nearestWithDistance;

// @ts-expect-error invalid color format
quantize(rgbaData, 2, { format: "rgb666" });

// @ts-expect-error colors must have exactly 3 or 4 channels
const invalidColor: Color = [0, 128];

// @ts-expect-error palette entries must be RGB or RGBA tuples
const invalidPalette: Palette = [[0, 128]];

applyPalette(rgbaData, palette, {
  // @ts-expect-error dither only accepts true, false, or floyd-steinberg
  dither: "jarvis-judice-ninke",
  width: 1,
});

void invalidColor;
void invalidPalette;
