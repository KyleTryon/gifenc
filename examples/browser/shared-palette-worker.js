import { createPaletteMapper, GIFEncoder } from "/dist/gifenc.mjs";

// Send { event: "init", palette, width, height, delay } once per worker.
// Send { event: "frame", data, frame } for each RGBA frame assigned to it.
let options;
let mapper;
self.addEventListener("message", ({ data: message }) => {
  if (message.event === "init") {
    options = message;
    mapper = createPaletteMapper(message.palette, { format: "rgb444" });
    self.postMessage("ready");
    return;
  }
  const index = mapper.map(message.data);
  const gif = GIFEncoder({ auto: false });
  gif.writeFrame(index, options.width, options.height, {
    first: message.frame === 0,
    palette: options.palette,
    delay: options.delay,
  });
  const output = gif.bytesView();
  self.postMessage([output, message.frame], [output.buffer]);
});
