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
  await Promise.race([
    page.evaluate(async () => {
      const moduleUrl = location.origin + "/examples/browser/worker-encoder.js";
      const { createWorkerEncoder } = await import(moduleUrl);
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const encoder = await createWorkerEncoder({
        totalFrames: 1,
        width: 1,
        height: 1,
      });
      const pixels = new Uint8Array([255, 0, 0, 255]);
      const frame = encoder.addFrame(pixels, 0);
      assert(pixels.byteLength === 0, "input was not transferred");
      await frame;
      const bytes = encoder.finish();
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/gif" }),
      );
      assert(bitmap.width === 1 && bitmap.height === 1, "GIF did not decode");
      bitmap.close();
      const controller = new AbortController();
      const cancelled = await createWorkerEncoder({
        totalFrames: 1,
        width: 1,
        height: 1,
        signal: controller.signal,
      });
      controller.abort();
      try {
        await cancelled.addFrame(new Uint8Array(4), 0);
        throw new Error("cancel did not reject");
      } catch (error) {
        assert(error.name === "AbortError", "wrong cancellation error");
      }
      try {
        await createWorkerEncoder({
          totalFrames: 1,
          width: 1,
          height: 1,
          workerUrl: "/missing-worker.js",
        });
        throw new Error("missing worker did not reject");
      } catch (error) {
        assert(
          error.message.includes("Worker failed"),
          "missing worker error lacked context",
        );
      }
      const failing = await createWorkerEncoder({
        totalFrames: 1,
        width: 1,
        height: 1,
        workerUrl: "/test/browser/failing-worker.js",
      });
      try {
        await failing.addFrame(new Uint8Array(4), 0);
        throw new Error("frame failure did not reject");
      } catch (error) {
        assert(
          error.message.includes("intentional frame failure"),
          "frame failure lacked context",
        );
      }
      const interrupted = await createWorkerEncoder({
        totalFrames: 1,
        width: 1,
        height: 1,
      });
      const inFlight = interrupted.addFrame(new Uint8Array(4), 0);
      interrupted.cancel();
      try {
        await inFlight;
        throw new Error("in-flight cancel did not reject");
      } catch (error) {
        assert(error.name === "AbortError", "in-flight cancellation failed");
      }
      const bounded = await createWorkerEncoder({
        totalFrames: 2,
        width: 1,
        height: 1,
      });
      const first = bounded.addFrame(new Uint8Array(4), 0);
      try {
        await bounded.addFrame(new Uint8Array(4), 0);
        throw new Error("concurrent frame accepted");
      } catch (error) {
        assert(
          error.message.includes("Await"),
          "concurrent frame error lacked context",
        );
      }
      await first;
      bounded.cancel();
    }),
    delay(15000).then(() => {
      throw new Error("Browser smoke test timed out");
    }),
  ]);
  console.log("Browser worker smoke test passed");
} finally {
  await browser?.close();
  server.kill();
}
