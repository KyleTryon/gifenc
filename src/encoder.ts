import constants from "./constants.js";
import lzwEncode, { LZW_HASH_SIZE, LZW_LARGE_HASH_SIZE } from "./lzw-encode.js";
import createStream from "./stream.js";
import {
  assertPalette,
  assertColorDepth,
  assertDelay,
  assertDispose,
  assertRepeat,
  assertTransparentIndex,
} from "./validation.js";
import type {
  ByteStream,
  GIFEncoderInstance,
  GIFEncoderOptions,
  Palette,
} from "./types.js";

/**
 * Create a stateful GIF encoder.
 *
 * The usual flow is:
 *
 * 1. Create a palette with {@link quantize}.
 * 2. Convert RGBA pixels to palette indexes with {@link applyPalette}.
 * 3. Write one or more indexed frames.
 * 4. Call {@link GIFEncoderInstance.finish} and read the bytes.
 *
 * In default auto mode, the encoder writes the GIF header and global color
 * table when the first frame is written.
 *
 * @param opt - Encoder configuration.
 * @returns A mutable encoder instance.
 */
export function GIFEncoder(opt: GIFEncoderOptions = {}): GIFEncoderInstance {
  return createEncoder(opt);
}

/** @internal */
export function createEncoder(
  opt: GIFEncoderOptions,
  globalPaletteLength = 0,
): GIFEncoderInstance {
  const { initialCapacity = 4096, auto = true } = opt;

  // Stream all encoded data into this buffer
  const stream = createStream(initialCapacity);

  // Shared array data across all frames
  const accum = new Uint8Array(256);
  let htab = new Int32Array(LZW_HASH_SIZE);
  let codetab = new Int32Array(LZW_HASH_SIZE);

  let hasInit = false;
  const initialGlobalPaletteLength = globalPaletteLength;
  let screenWidth = 0;
  let screenHeight = 0;

  return {
    reset() {
      stream.reset();
      hasInit = false;
      globalPaletteLength = initialGlobalPaletteLength;
      screenWidth = 0;
      screenHeight = 0;
    },
    finish() {
      stream.writeByte(constants.trailer);
    },
    bytes() {
      return stream.bytes();
    },
    bytesView() {
      return stream.bytesView();
    },
    get buffer() {
      return stream.buffer;
    },
    get stream() {
      return stream;
    },
    writeHeader,
    writeFrame(index, width, height, opts = {}) {
      const {
        transparent = false,
        transparentIndex = 0x00,
        delay = 0,
        palette = null,
        repeat = 0, // -1=once, 0=forever, >0=count
        colorDepth = 8,
        dispose = -1,
      } = opts;

      let first = false;
      if (auto) {
        // In 'auto' mode, the first time we write a frame
        // we will write LSD/GCT/EXT
        if (!hasInit) {
          // have not yet init, we can consider this our first frame
          first = true;
        }
      } else {
        // in manual mode, the first frame is determined by the options only
        first = Boolean(opts.first);
      }

      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 0xffff ||
        height > 0xffff
      ) {
        throw new Error(
          "GIFEncoder.writeFrame() expected integer dimensions in the range 1..65535",
        );
      }
      if (
        !first &&
        screenWidth > 0 &&
        (width > screenWidth || height > screenHeight)
      ) {
        throw new Error(
          "GIFEncoder.writeFrame() expected frame dimensions within the logical screen",
        );
      }
      if (!(index instanceof Uint8Array)) {
        throw new Error(
          "GIFEncoder.writeFrame() expected index to be a Uint8Array",
        );
      }
      if (index.length !== width * height) {
        throw new Error(
          "GIFEncoder.writeFrame() expected index length to match width * height",
        );
      }
      assertColorDepth(colorDepth, "GIFEncoder.writeFrame");
      assertTransparentIndex(transparentIndex, "GIFEncoder.writeFrame");
      assertDelay(delay, "GIFEncoder.writeFrame");
      assertRepeat(repeat, "GIFEncoder.writeFrame");
      assertDispose(dispose, "GIFEncoder.writeFrame");

      const globalPalette = first ? palette : null;
      const localPalette = !first ? palette : null;
      if (first && !globalPalette) {
        throw new Error("First frame must include a { palette } option");
      }
      if (palette !== null) {
        assertPalette(palette, "GIFEncoder.writeFrame");
      }
      const paletteLength = palette?.length ?? globalPaletteLength;
      if (paletteLength === 0) {
        throw new Error(
          "GIFEncoder.writeFrame() requires a palette or a previously written global palette",
        );
      }
      if (paletteLength > 1 << colorDepth) {
        throw new Error(
          "GIFEncoder.writeFrame() expected colorDepth to accommodate the active palette",
        );
      }
      if (transparent && transparentIndex >= paletteLength) {
        throw new Error(
          "GIFEncoder.writeFrame() expected transparentIndex within the active palette",
        );
      }
      for (const pixel of index) {
        if (pixel >= paletteLength) {
          throw new Error(
            "GIFEncoder.writeFrame() expected every index within the active palette",
          );
        }
      }

      // All validation is done; from here on every write is unconditional so
      // a failing call leaves the stream untouched and the encoder usable.
      // Large frames benefit from fewer hash probes; small frames avoid the
      // allocation and clearing cost of the larger table.
      if (
        index.length >= 16384 &&
        paletteLength > 16 &&
        htab.length === LZW_HASH_SIZE
      ) {
        htab = new Int32Array(LZW_LARGE_HASH_SIZE);
        codetab = new Int32Array(LZW_LARGE_HASH_SIZE);
      }
      if (first && auto) {
        writeHeader();
        hasInit = true;
      }
      // Write pre-frame details such as repeat count and global palette
      if (first && globalPalette) {
        globalPaletteLength = globalPalette.length;
        screenWidth = width;
        screenHeight = height;
        encodeLogicalScreenDescriptor(
          stream,
          width,
          height,
          globalPalette,
          colorDepth,
        );
        encodeColorTable(stream, globalPalette);
        if (repeat >= 0) {
          encodeNetscapeExt(stream, repeat);
        }
      }

      const delayTime = Math.round(delay / 10);
      encodeGraphicControlExt(
        stream,
        dispose,
        delayTime,
        transparent,
        transparentIndex,
      );

      encodeImageDescriptor(stream, width, height, localPalette);
      if (localPalette) encodeColorTable(stream, localPalette);
      lzwEncode(index, colorDepth, stream, accum, htab, codetab);
    },
  };

  function writeHeader(): void {
    writeUTFBytes(stream, "GIF89a");
  }
}

function encodeGraphicControlExt(
  stream: ByteStream,
  dispose: number,
  delay: number,
  transparent: boolean,
  transparentIndex: number,
): void {
  stream.writeByte(0x21); // extension introducer
  stream.writeByte(0xf9); // GCE label
  stream.writeByte(4); // data block size

  if (transparentIndex < 0) {
    transparentIndex = 0x00;
    transparent = false;
  }

  let transp: number;
  let disp: number;
  if (!transparent) {
    transp = 0;
    disp = 0; // dispose = no action
  } else {
    transp = 1;
    disp = 2; // force clear if using transparent color
  }

  if (dispose >= 0) {
    disp = dispose & 7; // user override
  }

  disp <<= 2;

  const userInput = 0;

  // packed fields
  stream.writeByte(
    0 | // 1:3 reserved
      disp | // 4:6 disposal
      userInput | // 7 user input - 0 = none
      transp, // 8 transparency flag
  );

  writeUInt16(stream, delay); // delay x 1/100 sec
  stream.writeByte(transparentIndex || 0x00); // transparent color index
  stream.writeByte(0); // block terminator
}

function encodeLogicalScreenDescriptor(
  stream: ByteStream,
  width: number,
  height: number,
  palette: Palette,
  colorDepth = 8,
): void {
  const globalColorTableFlag = 1;
  const sortFlag = 0;
  const globalColorTableSize = colorTableSize(palette.length) - 1;
  const fields =
    (globalColorTableFlag << 7) |
    ((colorDepth - 1) << 4) |
    (sortFlag << 3) |
    globalColorTableSize;
  const backgroundColorIndex = 0;
  const pixelAspectRatio = 0;
  writeUInt16(stream, width);
  writeUInt16(stream, height);
  stream.writeBytes([fields, backgroundColorIndex, pixelAspectRatio]);
}

function encodeNetscapeExt(stream: ByteStream, repeat: number): void {
  stream.writeByte(0x21); // extension introducer
  stream.writeByte(0xff); // app extension label
  stream.writeByte(11); // block size
  writeUTFBytes(stream, "NETSCAPE2.0"); // app id + auth code
  stream.writeByte(3); // sub-block size
  stream.writeByte(1); // loop sub-block id
  writeUInt16(stream, repeat); // loop count (extra iterations, 0=repeat forever)
  stream.writeByte(0); // block terminator
}

function encodeColorTable(stream: ByteStream, palette: Palette): void {
  const colorTableLength = 1 << colorTableSize(palette.length);
  for (let i = 0; i < colorTableLength; i++) {
    const color = i < palette.length ? palette[i] : undefined;
    stream.writeByte(color?.[0] ?? 0);
    stream.writeByte(color?.[1] ?? 0);
    stream.writeByte(color?.[2] ?? 0);
  }
}

function encodeImageDescriptor(
  stream: ByteStream,
  width: number,
  height: number,
  localPalette: Palette | null,
): void {
  stream.writeByte(0x2c); // image separator

  writeUInt16(stream, 0); // x position
  writeUInt16(stream, 0); // y position
  writeUInt16(stream, width); // image size
  writeUInt16(stream, height);

  if (localPalette) {
    const interlace = 0;
    const sorted = 0;
    const palSize = colorTableSize(localPalette.length) - 1;
    // local palette
    stream.writeByte(
      0x80 | // 1 local color table 1=yes
        interlace | // 2 interlace - 0=no
        sorted | // 3 sorted - 0=no
        0 | // 4-5 reserved
        palSize, // 6-8 size of color table
    );
  } else {
    // global palette
    stream.writeByte(0);
  }
}

// Utilities

function writeUInt16(stream: ByteStream, short: number): void {
  stream.writeByte(short & 0xff);
  stream.writeByte((short >> 8) & 0xff);
}

function writeUTFBytes(stream: ByteStream, text: string): void {
  for (let i = 0; i < text.length; i++) {
    stream.writeByte(text.charCodeAt(i));
  }
}

function colorTableSize(length: number): number {
  return Math.max(Math.ceil(Math.log2(length)), 1);
}

export default GIFEncoder;
