import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: { ...process.env, PORT: "5199" },
  stdio: "inherit",
});
let browser;
try {
  for (let i = 0; ; i++) {
    try {
      await fetch("http://127.0.0.1:5199/");
      break;
    } catch (error) {
      if (i === 50) throw error;
      await delay(100);
    }
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto("http://127.0.0.1:5199/examples/browser/");
  const result = await Promise.race([
    page.evaluate(async () => {
      const moduleUrl = location.origin + "/examples/browser/worker-encoder.js";
      const { createWorkerEncoder } = await import(moduleUrl);
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const libraryUrl = location.origin + "/dist/gifenc.mjs";
      const { GIFEncoder, quantize, applyPalette } = await import(libraryUrl);
      const rgba = new Uint8Array([0, 255, 0, 255]);
      const palette = quantize(rgba, 256);
      const direct = GIFEncoder();
      direct.writeFrame(applyPalette(rgba, palette), 1, 1, { palette });
      direct.finish();
      const bitmap = await createImageBitmap(
        new Blob([direct.bytesView()], { type: "image/gif" }),
      );
      assert(
        bitmap.width === 1 && bitmap.height === 1,
        "direct GIF did not decode",
      );
      bitmap.close();
      for (const workerCount of [0, -1, 1.5]) {
        try {
          await createWorkerEncoder({
            totalFrames: 1,
            width: 1,
            height: 1,
            workerCount,
          });
          throw new Error("invalid worker count accepted");
        } catch (error) {
          assert(
            error.message.includes("positive integer"),
            "worker count error lacked context",
          );
        }
      }
      const RealWorker = window.Worker;
      const instances = [];
      const order = [];
      window.Worker = class extends RealWorker {
        constructor(...args) {
          super(...args);
          this.terminated = false;
          instances.push(this);
          this.addEventListener("message", ({ data }) => {
            if (Array.isArray(data)) order.push(data[1]);
          });
        }
        terminate() {
          this.terminated = true;
          return super.terminate();
        }
      };
      const opts = {
        totalFrames: 3,
        width: 2,
        height: 2,
        workerCount: 2,
        workerUrl: "/test/browser/delayed-worker.js",
      };
      const encoder = await createWorkerEncoder(opts);
      const color = (r, g, b) =>
        new Uint8Array(Array.from({ length: 4 }, () => [r, g, b, 255]).flat());
      const red = color(255, 0, 0);
      await encoder.ready();
      encoder.addFrame(red, 0);
      assert(red.byteLength === 0, "input not transferred");
      await encoder.ready();
      encoder.addFrame(color(0, 255, 0), 1);
      let released = false;
      const blocked = encoder.ready().then(() => {
        released = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert(!released, "capacity wait did not block");
      try {
        await encoder.ready();
        throw new Error("second waiter accepted");
      } catch (error) {
        assert(
          error.message.includes("Only one producer"),
          "single producer guard failed",
        );
      }
      await blocked;
      assert(order[0] === 1, "workers did not complete out of order");
      encoder.addFrame(color(0, 0, 255), 2);
      const bytes = await encoder.finish();
      assert(
        instances.every((worker) => worker.terminated),
        "success leaked workers",
      );
      const oldCount = instances.length;
      const controller = new AbortController();
      const cancelled = await createWorkerEncoder({
        ...opts,
        signal: controller.signal,
      });
      await cancelled.ready();
      cancelled.addFrame(color(255, 0, 0), 0);
      await cancelled.ready();
      cancelled.addFrame(color(0, 255, 0), 1);
      const waiting = cancelled.ready();
      controller.abort();
      try {
        await waiting;
        throw new Error("cancel did not reject waiter");
      } catch (error) {
        assert(error.name === "AbortError", "wrong cancellation error");
      }
      assert(
        instances.slice(oldCount).every((worker) => worker.terminated),
        "cancel leaked workers",
      );
      const already = new AbortController();
      already.abort();
      const beforeAlready = instances.length;
      try {
        await createWorkerEncoder({ ...opts, signal: already.signal });
        throw new Error("already-aborted signal accepted");
      } catch (error) {
        assert(error.name === "AbortError", "already-aborted signal failed");
      }
      assert(
        instances.length === beforeAlready,
        "already-aborted signal created workers",
      );
      const directCancel = await createWorkerEncoder(opts);
      directCancel.cancel();
      assert(
        instances.every((worker) => worker.terminated),
        "cancel leaked workers",
      );
      const failureStart = instances.length;
      try {
        await createWorkerEncoder({ ...opts, workerUrl: "/missing-worker.js" });
        throw new Error("startup succeeded");
      } catch (error) {
        assert(
          error.message.includes("Worker failed"),
          "startup error lacked context",
        );
      }
      assert(
        instances.slice(failureStart).every((worker) => worker.terminated),
        "startup leaked workers",
      );
      const failed = await createWorkerEncoder({
        ...opts,
        workerUrl: "/test/browser/failing-worker.js",
      });
      await failed.ready();
      failed.addFrame(color(0, 0, 0), 0);
      try {
        await failed.finish();
        throw new Error("incomplete finish accepted");
      } catch (error) {
        assert(error.message.includes("All frames"), "wrong finish error");
      }
      await failed.ready();
      failed.addFrame(color(0, 0, 0), 1);
      const failureWait = failed.ready();
      try {
        await failureWait;
        throw new Error("frame failure succeeded");
      } catch (error) {
        assert(
          error.message.includes("intentional frame failure"),
          "frame failure lacked context",
        );
      }
      assert(
        instances.every((worker) => worker.terminated),
        "failure leaked workers",
      );
      const finishFailure = await createWorkerEncoder({
        ...opts,
        totalFrames: 1,
        workerUrl: "/test/browser/failing-worker.js",
      });
      await finishFailure.ready();
      finishFailure.addFrame(color(0, 0, 0), 0);
      try {
        await finishFailure.finish();
        throw new Error("failed finish succeeded");
      } catch (error) {
        assert(
          error.message.includes("intentional frame failure"),
          "finish failure lacked context",
        );
      }
      assert(
        instances.every((worker) => worker.terminated),
        "finish failure leaked workers",
      );
      const msg = await createWorkerEncoder(opts);
      await msg.ready();
      msg.addFrame(color(0, 0, 0), 0);
      const messageWorker = instances.at(-2);
      messageWorker.dispatchEvent(new MessageEvent("messageerror"));
      try {
        await msg.ready();
        throw new Error("messageerror succeeded");
      } catch (error) {
        assert(
          error.message.includes("decoded"),
          "messageerror lacked context",
        );
      }
      assert(
        instances.every((worker) => worker.terminated),
        "messageerror leaked workers",
      );
      async function bench(workerCount) {
        const count = 48,
          size = 256;
        const pool = await createWorkerEncoder({
          totalFrames: count,
          width: size,
          height: size,
          workerCount,
        });
        const start = performance.now();
        for (let frame = 0; frame < count; frame++) {
          await pool.ready();
          const data = new Uint8Array(size * size * 4);
          for (let i = 0; i < data.length; i += 4) {
            const p = i / 4;
            data[i] = (p + frame * 3) % 256;
            data[i + 1] = (p >> 8) % 256;
            data[i + 2] = (p * 7 + frame) % 256;
            data[i + 3] = 255;
          }
          pool.addFrame(data, frame);
        }
        await pool.finish();
        return performance.now() - start;
      }
      const one = [await bench(1)],
        four = [await bench(4)];
      four.push(await bench(4));
      one.push(await bench(1));
      return { bytes: Array.from(bytes), one, four, order };
    }),
    delay(60000, undefined, { ref: false }).then(() => {
      throw new Error("Browser smoke test timed out");
    }),
  ]);
  const { GifReader } = await import("omggif");
  const reader = new GifReader(Uint8Array.from(result.bytes));
  if (reader.numFrames() !== 3) throw new Error("Wrong frame count");
  for (let frame = 0; frame < 3; frame++) {
    const pixels = new Uint8Array(16);
    reader.decodeAndBlitFrameRGBA(frame, pixels);
    const expected = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ][frame];
    if (!expected.every((value, channel) => pixels[channel] === value))
      throw new Error(`Wrong decoded frame ${frame}`);
  }
  console.log(
    `48 independent 256x256 frames: 1 worker ${result.one.map((n) => n.toFixed(0)).join(" / ")} ms, 4 workers ${result.four.map((n) => n.toFixed(0)).join(" / ")} ms; completion order ${result.order.slice(0, 3)}`,
  );
  console.log("Browser worker smoke test passed");
} finally {
  await browser?.close();
  server.kill();
}
