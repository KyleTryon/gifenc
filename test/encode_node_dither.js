import * as path from "path";
import { readFile, writeFile } from "fs/promises";
import pngjs from "pngjs";
import { GIFEncoder, quantize, applyPalette } from "../src/index.js";

const { PNG } = pngjs;
const __dirname = import.meta.dirname;

encode();

async function encode() {
  const { data, width, height } = await readImage(
    path.resolve(__dirname, "fixtures/baboon.png"),
  );

  const format = "rgb565";
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

async function writeGif(index, width, height, palette, file) {
  const gif = GIFEncoder();
  gif.writeFrame(index, width, height, { palette });
  gif.finish();
  await writeFile(file, Buffer.from(gif.bytes()));
}

async function readImage(file) {
  const { data, width, height } = PNG.sync.read(await readFile(file));
  return { data, width, height };
}
