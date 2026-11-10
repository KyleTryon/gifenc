import { GIFEncoder } from "/dist/gifenc.mjs";

// A single producer awaits ready() before allocating its next frame.
// Capacity is not reserved for concurrent producers.
// addFrame() transfers the frame immediately; finish() waits for completion.
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
  workerCount = Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1)),
}) {
  if (!Number.isInteger(totalFrames) || totalFrames < 1 || !width || !height)
    throw new Error("Specify totalFrames, width and height");
  if (!Number.isInteger(workerCount) || workerCount < 1)
    throw new Error("workerCount must be a positive integer");
  const workers = [];
  const chunks = new Array(totalFrames);
  let admitted = 0,
    completed = 0,
    failure,
    closed = false,
    waiter;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const slot of workers) slot.worker.terminate();
    signal?.removeEventListener("abort", abort);
  };
  const wake = () => {
    if (waiter) {
      const current = waiter;
      waiter = undefined;
      current();
    }
  };
  const fail = (error) => {
    if (failure || closed) return;
    failure = error;
    cleanup();
    wake();
  };
  const abort = () =>
    fail(new DOMException("Encoding cancelled", "AbortError"));
  const check = () => {
    if (failure) throw failure;
    if (closed) throw new Error("Encoder is closed");
  };
  const wait = () => {
    if (waiter) throw new Error("Only one producer may wait for capacity");
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    check();
    for (let i = 0; i < Math.min(workerCount, totalFrames); i++) {
      const worker = new Worker(workerUrl, { type: "module" });
      const slot = { worker, ready: false, frame: null };
      workers.push(slot);
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        fail(new Error(`Worker failed: ${event.message}`));
      });
      worker.addEventListener("messageerror", () =>
        fail(new Error("Worker message could not be decoded")),
      );
      worker.addEventListener("message", ({ data }) => {
        if (closed) return;
        if (!slot.ready) {
          if (data !== "ready")
            return fail(new Error("Worker failed to initialize"));
          slot.ready = true;
        } else {
          if (
            slot.frame === null ||
            !Array.isArray(data) ||
            data[1] !== slot.frame ||
            !(data[0] instanceof Uint8Array)
          )
            return fail(new Error("Unexpected worker response"));
          chunks[slot.frame] = data[0];
          slot.frame = null;
          completed++;
          try {
            progress(completed / totalFrames);
          } catch (error) {
            return fail(error);
          }
        }
        wake();
      });
      worker.postMessage({
        event: "init",
        width,
        height,
        maxColors,
        format,
        delay: 1000 / fps,
      });
    }
    while (!workers.every((slot) => slot.ready)) {
      check();
      await wait();
    }
    check();
  } catch (error) {
    fail(error);
    throw error;
  }
  return {
    async ready() {
      check();
      while (!workers.some((slot) => slot.frame === null)) {
        await wait();
        check();
      }
    },
    addFrame(data, frame) {
      check();
      if (frame !== admitted || frame >= totalFrames)
        throw new Error("Frames must be added in order");
      const slot = workers.find((item) => item.frame === null);
      if (!slot) throw new Error("Await ready() before adding a frame");
      slot.frame = frame;
      admitted++;
      try {
        slot.worker.postMessage([data, frame], [data.buffer]);
      } catch (error) {
        fail(error);
        throw error;
      }
    },
    async finish() {
      check();
      if (admitted !== totalFrames)
        throw new Error("All frames must be admitted before finishing");
      while (completed < totalFrames) {
        await wait();
        check();
      }
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
