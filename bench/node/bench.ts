import * as path from "node:path";
import { readFile } from "node:fs/promises";
import * as pngjs from "pngjs";
import {
  GIFEncoder,
  applyPalette,
  quantize,
  type Format,
  type Palette,
  type RGBAInput,
} from "gifenc";

const { PNG } = pngjs;
const __dirname = import.meta.dirname;

const N = 100;

type SourceImage = {
  data: RGBAInput;
  width: number;
  height: number;
};

(async () => {
  // Load width/height + RGBA uint8 array data
  const { data, width, height } = await readImage(
    path.resolve(__dirname, "../../test/fixtures/baboon.png"),
  );

  const format: Format = "rgb444";

  benchQuantize(data, format);

  const palette = quantize(data, 256, { format });
  benchPalette(data, palette, format);

  const index = applyPalette(data, palette, format);
  benchEncode(index, width, height, palette);
})();

function benchQuantize(data: RGBAInput, format: Format): void {
  console.log("Quantization");
  console.time("time");
  for (let i = 0; i < N; i++) {
    quantize(data, 256, { format });
  }
  console.timeEnd("time");
}

function benchPalette(data: RGBAInput, palette: Palette, format: Format): void {
  console.log("Palettization");
  console.time("time");
  for (let i = 0; i < N; i++) {
    applyPalette(data, palette, format);
  }
  console.timeEnd("time");
}

function benchEncode(
  index: Uint8Array,
  width: number,
  height: number,
  palette: Palette,
): void {
  console.log("Encode");
  console.time("time");
  for (let i = 0; i < N; i++) {
    const encoder = GIFEncoder({ auto: false });
    encoder.writeFrame(index, width, height, { palette });
  }
  console.timeEnd("time");
}

async function readImage(file: string): Promise<SourceImage> {
  const { data, width, height } = PNG.sync.read(await readFile(file));
  return { data, width, height };
}
