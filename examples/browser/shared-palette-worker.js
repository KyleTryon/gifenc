import { createPaletteMapper, encodeFrameChunk } from "/dist/gifenc.mjs";

// Use with worker-encoder.js for independent, non-dithered shared-palette frames.
// Each worker snapshots the shared palette on its first frame and reuses its mapper.
let options;
let mapper;
self.addEventListener("message", ({ data: message }) => {
  if (message.event === "init") {
    options = message;
    mapper = undefined;
    self.postMessage("ready");
    return;
  }
  const [data, frame, globalPalette, delay] = message;
  mapper ??= createPaletteMapper(globalPalette, { format: options.format });
  const chunk = encodeFrameChunk(
    mapper.map(data),
    options.width,
    options.height,
    {
      sequenceIndex: frame,
      globalPalette,
      delay,
    },
  );
  self.postMessage([chunk, frame], [chunk.bytes.buffer]);
});
