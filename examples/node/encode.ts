import * as path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as pngjs from "pngjs";
import {
  GIFEncoder,
  applyPalette,
  quantize,
  type Format,
  type RGBAInput,
} from "gifenc";

const { PNG } = pngjs;
const __dirname = import.meta.dirname;

encode();

type SourceImage = {
  data: RGBAInput;
  width: number;
  height: number;
};

async function encode(): Promise<void> {
  // Load width/height + RGBA uint8 array data
  const { data, width, height } = await readImage(
    path.resolve(__dirname, "../../test/fixtures/baboon.png"),
  );

  // Choose a pixel format: rgba4444, rgb444, rgb565
  const format: Format = "rgb444";

  // If necessary, quantize your colors to a reduced palette
  const palette = quantize(data, 256, { format });

  // Apply palette to RGBA data to get an indexed bitmap
  const index = applyPalette(data, palette, format);

  // Now let's encode it into a GIF
  const gif = GIFEncoder();

  // Write a single frame into the encoder
  gif.writeFrame(index, width, height, { palette });

  // Finish encoding (write end-of-file character)
  gif.finish();

  // Get a uint8array buffer with our bytes
  const bytes = gif.bytes();

  // Write the uint8 array data to file
  const outputFile = path.resolve(__dirname, "output/test.gif");
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, Buffer.from(bytes));
}

async function readImage(file: string): Promise<SourceImage> {
  const { data, width, height } = PNG.sync.read(await readFile(file));
  return { data, width, height };
}
