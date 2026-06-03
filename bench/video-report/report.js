import {
  GIFEncoder,
  applyPalette,
  createTemporalDither,
  quantize,
} from "../../dist/gifenc.mjs";

const SOURCE_URL = "../fixtures/basketball_5s_320p.mp4";
const SOURCE_FPS = 24;

const variants = [
  {
    id: "full-256",
    name: "Full 256",
    scale: 1,
    fps: 24,
    colors: 256,
    format: "rgb565",
    paletteStrategy: "frame",
    dither: false,
  },
  {
    id: "full-256-dithered",
    name: "Full 256 dithered",
    scale: 1,
    fps: 24,
    colors: 256,
    format: "rgb565",
    paletteStrategy: "frame",
    dither: true,
  },
  {
    id: "balanced-128",
    name: "Balanced 128",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    dither: false,
  },
  {
    id: "balanced-128-dithered",
    name: "Balanced 128 dithered",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    dither: true,
  },
  {
    id: "shared-palette-128",
    name: "Shared palette 128",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "shared",
    dither: false,
  },
  {
    id: "compact-64",
    name: "Compact 64",
    scale: 0.5,
    fps: 12,
    colors: 64,
    format: "rgb444",
    paletteStrategy: "frame",
    dither: false,
  },
];

const runButton = document.querySelector("#run-button");
const resetButton = document.querySelector("#reset-button");
const statusText = document.querySelector("#status");
const progressBar = document.querySelector("#progress");
const sourceVideo = document.querySelector("#source-video");
const sourceMetrics = document.querySelector("#source-metrics");
const sourceUrl = document.querySelector("#source-url");
const resultsBody = document.querySelector("#results-body");
const resultGrid = document.querySelector("#result-grid");

let source = null;
let sourceBlobUrl = "";
let decodedFrames = null;
let running = false;
let resultUrls = [];

init().catch((error) => {
  setStatus(`Could not load source video: ${error.message}`);
  console.error(error);
});

runButton.addEventListener("click", () => {
  runBenchmark().catch((error) => {
    running = false;
    runButton.disabled = !source;
    setStatus(`Benchmark failed: ${error.message}`);
    console.error(error);
  });
});

resetButton.addEventListener("click", () => {
  clearResults();
  if (source) {
    renderSourceRow(source);
  }
  decodedFrames = null;
  setProgress(0);
  setStatus(source ? "Ready." : "Loading source video...");
});

async function init() {
  clearResults();
  sourceUrl.textContent = SOURCE_URL;

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const sourceBlob = await response.blob();
  sourceBlobUrl = URL.createObjectURL(sourceBlob);
  sourceVideo.src = sourceBlobUrl;
  await waitForMetadata(sourceVideo);

  source = {
    width: sourceVideo.videoWidth,
    height: sourceVideo.videoHeight,
    duration: sourceVideo.duration,
    fps: SOURCE_FPS,
    frameCount: Math.round(sourceVideo.duration * SOURCE_FPS),
    size: sourceBlob.size,
  };

  renderSourceMetrics(source);
  renderSourceRow(source);
  runButton.disabled = false;
  setStatus("Ready.");
}

async function runBenchmark() {
  if (!source || running) return;

  running = true;
  runButton.disabled = true;
  clearResults();
  renderSourceRow(source);
  setProgress(0);

  decodedFrames ??= await decodeSourceFrames(sourceBlobUrl, source);

  for (const [index, variant] of variants.entries()) {
    setStatus(`Encoding ${variant.name}...`);
    const progressOffset = (index / variants.length) * 100;
    const progressSpan = 100 / variants.length;
    const result = await encodeVariant(source, decodedFrames, variant, (part) =>
      setProgress(progressOffset + part * progressSpan),
    );

    renderVariantResult(source, variant, result);
    await yieldToBrowser();
  }

  setProgress(100);
  setStatus("Benchmark complete.");
  running = false;
  runButton.disabled = false;
}

async function decodeSourceFrames(videoUrl, metadata) {
  setStatus("Decoding source frames...");

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;

  await waitForMetadata(video);
  await waitForLoadedData(video);

  const canvas = document.createElement("canvas");
  canvas.width = metadata.width;
  canvas.height = metadata.height;
  const context = getContext(canvas);
  const frames = [];

  for (let i = 0; i < metadata.frameCount; i++) {
    const time = Math.min(i / metadata.fps, metadata.duration - 0.001);
    await seekVideo(video, time);
    context.drawImage(video, 0, 0, metadata.width, metadata.height);
    const image = context.getImageData(0, 0, metadata.width, metadata.height);
    frames.push(image.data.slice());
    setProgress((i / metadata.frameCount) * 10);

    if (i % 4 === 0) {
      await yieldToBrowser();
    }
  }

  video.removeAttribute("src");
  video.load();
  return frames;
}

async function encodeVariant(metadata, frames, variant, onProgress) {
  const started = performance.now();
  const width = Math.max(1, Math.round(metadata.width * variant.scale));
  const height = Math.max(1, Math.round(metadata.height * variant.scale));
  const frameCount = Math.round(metadata.duration * variant.fps);
  const selectedFrames = [];
  const scaleScratch =
    variant.scale === 1
      ? null
      : createScaleScratch(metadata.width, metadata.height, width, height);

  for (let i = 0; i < frameCount; i++) {
    const sourceIndex = Math.min(
      frames.length - 1,
      Math.floor((i * metadata.fps) / variant.fps),
    );
    const frame = frames[sourceIndex];
    selectedFrames.push(
      scaleScratch
        ? scaleFrame(frame, metadata.width, metadata.height, scaleScratch)
        : frame,
    );
    onProgress((i / frameCount) * 0.2);

    if (i % 4 === 0) {
      await yieldToBrowser();
    }
  }

  const sharedPalette =
    variant.paletteStrategy === "shared"
      ? quantize(mergeFrames(selectedFrames), variant.colors, {
          format: variant.format,
        })
      : null;

  onProgress(0.25);

  const temporalDither = variant.dither
    ? createTemporalDither({
        width,
        height,
        format: variant.format,
      })
    : null;
  const encoder = GIFEncoder();
  const delay = 1000 / variant.fps;

  for (let i = 0; i < selectedFrames.length; i++) {
    const rgba = selectedFrames[i];
    const palette =
      sharedPalette ??
      quantize(rgba, variant.colors, {
        format: variant.format,
      });
    const index = applyPalette(
      rgba,
      palette,
      variant.dither
        ? {
            format: variant.format,
            dither: "floyd-steinberg",
            width,
            height,
            temporalDither,
          }
        : variant.format,
    );

    encoder.writeFrame(index, width, height, {
      delay,
      palette:
        variant.paletteStrategy === "shared" && i > 0 ? undefined : palette,
    });

    onProgress(0.25 + (i / selectedFrames.length) * 0.75);

    if (i % 2 === 0) {
      await yieldToBrowser();
    }
  }

  encoder.finish();
  const bytes = encoder.bytes();
  const blob = new Blob([bytes], { type: "image/gif" });
  const url = URL.createObjectURL(blob);
  resultUrls.push(url);

  return {
    url,
    bytes: bytes.length,
    width,
    height,
    frameCount,
    encodeMs: performance.now() - started,
  };
}

function createScaleScratch(sourceWidth, sourceHeight, width, height) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = getContext(sourceCanvas);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = getContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  return {
    sourceCanvas,
    sourceContext,
    canvas,
    context,
    width,
    height,
  };
}

function scaleFrame(frame, sourceWidth, sourceHeight, scratch) {
  scratch.sourceContext.putImageData(
    new ImageData(frame, sourceWidth, sourceHeight),
    0,
    0,
  );
  scratch.context.clearRect(0, 0, scratch.width, scratch.height);
  scratch.context.drawImage(
    scratch.sourceCanvas,
    0,
    0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    scratch.width,
    scratch.height,
  );
  return scratch.context.getImageData(0, 0, scratch.width, scratch.height).data;
}

function mergeFrames(frames) {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const merged = new Uint8ClampedArray(length);
  let offset = 0;

  for (const frame of frames) {
    merged.set(frame, offset);
    offset += frame.length;
  }

  return merged;
}

function renderSourceMetrics(metadata) {
  sourceMetrics.innerHTML = "";
  const metrics = [
    ["Dimensions", `${metadata.width} x ${metadata.height}`],
    ["Duration", `${formatNumber(metadata.duration, 1)}s`],
    ["Frame rate", `${metadata.fps} fps`],
    ["Frames", formatInteger(metadata.frameCount)],
    ["File size", formatBytes(metadata.size)],
    [
      "Bit rate",
      `${formatNumber((metadata.size * 8) / metadata.duration / 1000, 0)} kbps`,
    ],
  ];

  for (const [label, value] of metrics) {
    sourceMetrics.append(createMetric(label, value));
  }
}

function renderSourceRow(metadata) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>Source MP4</td>
    <td>${metadata.width} x ${metadata.height}</td>
    <td>${formatInteger(metadata.frameCount)}</td>
    <td>${metadata.fps}</td>
    <td>full quality video</td>
    <td>none</td>
    <td>${formatBytes(metadata.size)}</td>
    <td>1.00x</td>
    <td>n/a</td>
    <td><a class="download-link" href="${SOURCE_URL}">Open</a></td>
  `;
  resultsBody.append(row);
}

function renderVariantResult(metadata, variant, result) {
  const ratio = result.bytes / metadata.size;
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${variant.name}</td>
    <td>${result.width} x ${result.height}</td>
    <td>${formatInteger(result.frameCount)}</td>
    <td>${variant.fps}</td>
    <td>${variant.colors} colors, ${variant.format}, ${paletteLabel(variant)}</td>
    <td>${ditherLabel(variant)}</td>
    <td>${formatBytes(result.bytes)}</td>
    <td>${formatNumber(ratio, 2)}x</td>
    <td>${formatNumber(result.encodeMs / 1000, 2)}s</td>
    <td><a class="download-link" href="${result.url}" download="${variant.id}.gif">Download</a></td>
  `;
  resultsBody.append(row);

  const card =
    resultGrid.querySelector(`[data-variant-id="${variant.id}"]`) ??
    document.createElement("article");
  card.className = "result-card";
  card.dataset.variantId = variant.id;
  card.innerHTML = `
    <h3>${variant.name}</h3>
    <p class="result-meta">
      ${formatBytes(result.bytes)} / ${formatNumber(ratio, 2)}x MP4 / ${result.width} x ${result.height}
    </p>
    <div class="media-frame">
      <img src="${result.url}" alt="${variant.name} GIF preview" />
    </div>
  `;
  if (!card.isConnected) {
    resultGrid.append(card);
  }
}

function clearResults() {
  for (const url of resultUrls) {
    URL.revokeObjectURL(url);
  }
  resultUrls = [];
  resultsBody.innerHTML = "";
  resultGrid.innerHTML = "";

  for (const variant of variants) {
    const card = document.createElement("article");
    card.className = "result-card";
    card.dataset.variantId = variant.id;
    card.innerHTML = `
      <h3>${variant.name}</h3>
      <p class="result-meta">${variantSummary(variant)}</p>
      <div class="media-frame">
        <div class="empty-preview">Waiting for benchmark result</div>
      </div>
    `;
    resultGrid.append(card);
  }
}

function createMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "metric";
  metric.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
  return metric;
}

function variantSummary(variant) {
  const dimensions = variant.scale === 1 ? "full size" : "half scale";
  return `${dimensions}, ${variant.fps} fps, ${variant.colors} colors, ${variant.format}`;
}

function paletteLabel(variant) {
  return variant.paletteStrategy === "shared" ? "shared palette" : "per-frame";
}

function ditherLabel(variant) {
  return variant.dither ? "Floyd-Steinberg + temporal" : "none";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let i = 1; i < units.length && value >= 1024; i++) {
    value /= 1024;
    unit = units[i];
  }

  return `${formatNumber(value, value >= 100 ? 0 : 1)} ${unit}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value, digits) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setProgress(value) {
  progressBar.value = Math.max(0, Math.min(100, value));
}

function getContext(canvas) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context");
  }
  return context;
}

function waitForMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth > 0) {
    return Promise.resolve();
  }
  return waitForVideoEvent(video, "loadedmetadata");
}

function waitForLoadedData(video) {
  if (video.readyState >= 2) {
    return Promise.resolve();
  }
  return waitForVideoEvent(video, "loadeddata");
}

function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${formatNumber(time, 3)}s`));
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error ?? new Error("Video seek failed"));
    };

    video.addEventListener("seeked", handleSeeked);
    video.addEventListener("error", handleError);
    video.currentTime = time;
  });
}

function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error ?? new Error(`Video ${eventName} failed`));
    };

    video.addEventListener(eventName, handleEvent);
    video.addEventListener("error", handleError);
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
