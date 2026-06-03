import * as path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as pngjs from "pngjs";
import {
  GIFEncoder,
  applyPalette,
  quantize,
  type Format,
  type Palette,
  type RGBAInput,
} from "@techsquidtv/gifenc";

const { PNG } = pngjs;
const __dirname = import.meta.dirname;

encode();

type SourceImage = {
  data: RGBAInput;
  width: number;
  height: number;
};

async function encode(): Promise<void> {
  const { data, width, height } = await readImage(
    path.resolve(__dirname, "../../test/fixtures/baboon.png"),
  );

  const format: Format = "rgb565";
  const palette = quantize(data, 64, { format });

  const plainIndex = applyPalette(data, palette, { format });
  const ditheredIndex = applyPalette(data, palette, {
    format,
    dither: "floyd-steinberg",
    width,
    height,
  });

  await writeGif(
    plainIndex,
    width,
    height,
    palette,
    path.resolve(__dirname, "output/test-plain-64.gif"),
  );
  await writeGif(
    ditheredIndex,
    width,
    height,
    palette,
    path.resolve(__dirname, "output/test-dither-64.gif"),
  );
}

async function writeGif(
  index: Uint8Array,
  width: number,
  height: number,
  palette: Palette,
  file: string,
): Promise<void> {
  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette });
  gif.finish();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(gif.bytes()));
}

async function readImage(file: string): Promise<SourceImage> {
  const { data, width, height } = PNG.sync.read(await readFile(file));
  return { data, width, height };
}
