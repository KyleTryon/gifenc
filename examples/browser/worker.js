import { encodeFrameChunk, quantize, applyPalette } from "/dist/gifenc.mjs";

let options;

self.addEventListener("message", (ev) => {
  const detail = ev.data;
  if (detail.event === "init") {
    // Upon init, save our options
    options = { ...detail };
    // And send back a ready event
    self.postMessage("ready");
  } else {
    // Get the options for the encoder
    const { format = "rgb444", width, height, maxColors = 256 } = options;

    // Get the data + index for this frame
    const [data, frame, globalPalette, delay] = detail;

    // Get palette from this frame
    const palette =
      frame === 0 ? globalPalette : quantize(data, maxColors, { format });

    // Now get an indexed bitmap image
    const index = applyPalette(data, palette, format);

    // Encode into a single GIF frame chunk
    const chunk = encodeFrameChunk(index, width, height, {
      sequenceIndex: frame,
      globalPalette,
      ...(frame === 0 ? {} : { palette }),
      delay,
    });

    self.postMessage([chunk, frame], [chunk.bytes.buffer]);
  }
});
