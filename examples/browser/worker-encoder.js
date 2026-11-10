import { GIFEncoder } from "/dist/gifenc.mjs";

// Await each frame to keep at most one input buffer in flight.
export async function createWorkerEncoder({
  totalFrames,
  width,
  height,
  fps = 30,
  maxColors = 256,
  format = "rgb444",
  progress = () => {},
  workerUrl = "/examples/browser/worker.js",
  signal,
}) {
  if (!Number.isInteger(totalFrames) || totalFrames < 1 || !width || !height) {
    throw new Error("Specify totalFrames, width and height");
  }
  const worker = new Worker(workerUrl, { type: "module" });
  const chunks = [];
  let pending;
  let failure;
  let closed = false;
  const cleanup = () => {
    worker.terminate();
    signal?.removeEventListener("abort", abort);
    closed = true;
  };
  const fail = (error) => {
    failure = error;
    cleanup();
    if (pending) {
      pending.reject(error);
      pending = undefined;
    }
  };
  const abort = () =>
    fail(new DOMException("Encoding cancelled", "AbortError"));
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fail(new Error(`Worker failed: ${event.message}`));
  });
  worker.addEventListener("messageerror", () =>
    fail(new Error("Worker message could not be decoded")),
  );
  worker.addEventListener("message", (event) => {
    if (!pending) return;
    const current = pending;
    pending = undefined;
    current.resolve(event.data);
  });
  const request = (message, transfer = []) => {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error("Encoder is closed"));
    if (pending)
      return Promise.reject(
        new Error("Await the previous frame before adding another"),
      );
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        fail(error);
      }
    });
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const ready = await request({
      event: "init",
      width,
      height,
      maxColors,
      format,
      delay: 1000 / fps,
    });
    if (ready !== "ready") throw new Error("Worker failed to initialize");
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    async addFrame(data, frame) {
      if (frame !== chunks.length || frame >= totalFrames)
        throw new Error("Frames must be added in order");
      const result = await request([data, frame], [data.buffer]);
      if (
        !Array.isArray(result) ||
        result[1] !== frame ||
        !(result[0] instanceof Uint8Array)
      ) {
        const error = new Error("Unexpected worker response");
        fail(error);
        throw error;
      }
      chunks.push(result[0]);
      progress(chunks.length / totalFrames);
    },
    finish() {
      if (failure) throw failure;
      if (closed || pending || chunks.length !== totalFrames)
        throw new Error("Encoder is not ready to finish");
      try {
        const gif = GIFEncoder({ auto: false });
        gif.writeHeader();
        for (const chunk of chunks) gif.stream.writeBytesView(chunk);
        gif.finish();
        return gif.bytesView();
      } finally {
        cleanup();
      }
    },
    cancel: abort,
  };
}
