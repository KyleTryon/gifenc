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
    ditherMode: "none",
  },
  {
    id: "full-256-spatial-temporal",
    name: "Full 256 spatial + temporal",
    scale: 1,
    fps: 24,
    colors: 256,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial-temporal",
  },
  {
    id: "balanced-128",
    name: "Balanced 128",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "none",
  },
  {
    id: "balanced-128-spatial",
    name: "Balanced 128 spatial",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial",
  },
  {
    id: "balanced-128-spatial-temporal",
    name: "Balanced 128 spatial + temporal",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial-temporal",
  },
  {
    id: "shared-palette-128",
    name: "Shared palette 128",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "shared",
    ditherMode: "none",
  },
  {
    id: "compact-64",
    name: "Compact 64",
    scale: 0.5,
    fps: 12,
    colors: 64,
    format: "rgb444",
    paletteStrategy: "frame",
    ditherMode: "none",
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
const compareLeftSelect = document.querySelector("#compare-left");
const compareRightSelect = document.querySelector("#compare-right");
const compareLeftPane = document.querySelector("#compare-left-pane");
const compareRightPane = document.querySelector("#compare-right-pane");

let source = null;
let sourceBlobUrl = "";
let decodedFrames = null;
let running = false;
let resultUrls = [];
let resultsById = new Map();
const compareSelection = {
  left: "balanced-128-spatial",
  right: "balanced-128-spatial-temporal",
};

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

compareLeftSelect.addEventListener("change", () => {
  compareSelection.left = compareLeftSelect.value;
  renderComparison();
});

compareRightSelect.addEventListener("change", () => {
  compareSelection.right = compareRightSelect.value;
  renderComparison();
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
  renderCompareOptions();
  renderComparison();
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

  const temporalDither =
    variant.ditherMode === "spatial-temporal"
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
      usesSpatialDither(variant)
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
  resultsById.set(variant.id, result);
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
      ${formatBytes(result.bytes)} / ${formatNumber(ratio, 2)}x MP4 / ${result.width} x ${result.height} / ${ditherLabel(variant)}
    </p>
    <div class="media-frame">
      <img src="${result.url}" alt="${variant.name} GIF preview" />
    </div>
  `;
  if (!card.isConnected) {
    resultGrid.append(card);
  }
  renderCompareOptions();
  renderComparison();
}

function clearResults() {
  for (const url of resultUrls) {
    URL.revokeObjectURL(url);
  }
  resultUrls = [];
  resultsById = new Map();
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
  renderCompareOptions();
  renderComparison();
}

function createMetric(label, value) {
  const metric = document.createElement("div");
  metric.className = "metric";
  metric.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
  return metric;
}

function variantSummary(variant) {
  const dimensions = variant.scale === 1 ? "full size" : "half scale";
  return `${dimensions}, ${variant.fps} fps, ${variant.colors} colors, ${variant.format}, ${ditherLabel(variant)}`;
}

function paletteLabel(variant) {
  return variant.paletteStrategy === "shared" ? "shared palette" : "per-frame";
}

function ditherLabel(variant) {
  if (variant.ditherMode === "spatial") {
    return "spatial Floyd-Steinberg";
  }
  if (variant.ditherMode === "spatial-temporal") {
    return "spatial Floyd-Steinberg + temporal dithering";
  }
  return "none";
}

function renderCompareOptions() {
  renderCompareSelect(compareLeftSelect, compareSelection.left);
  renderCompareSelect(compareRightSelect, compareSelection.right);
}

function renderCompareSelect(select, selectedValue) {
  const choices = getCompareChoices();
  select.innerHTML = "";

  for (const choice of choices) {
    const option = document.createElement("option");
    option.value = choice.id;
    option.textContent = choice.name;
    option.disabled = !choice.available;
    select.append(option);
  }

  select.value = choices.some((choice) => choice.id === selectedValue)
    ? selectedValue
    : "source";
}

function renderComparison() {
  renderComparePane(compareLeftPane, compareSelection.left);
  renderComparePane(compareRightPane, compareSelection.right);
}

function renderComparePane(pane, choiceId) {
  const choice = getCompareChoice(choiceId);
  pane.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = choice.name;
  pane.append(title);

  const meta = document.createElement("p");
  meta.className = "compare-meta";
  meta.textContent = choice.meta;
  pane.append(meta);

  const mediaFrame = document.createElement("div");
  mediaFrame.className = "media-frame";
  pane.append(mediaFrame);

  if (!choice.available) {
    const placeholder = document.createElement("div");
    placeholder.className = "compare-placeholder";
    placeholder.textContent = choice.placeholder;
    mediaFrame.append(placeholder);
    return;
  }

  if (choice.type === "source") {
    const video = document.createElement("video");
    video.src = sourceBlobUrl;
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    mediaFrame.append(video);
    return;
  }

  const image = document.createElement("img");
  image.src = choice.result.url;
  image.alt = `${choice.name} GIF comparison preview`;
  mediaFrame.append(image);
}

function getCompareChoices() {
  return [
    {
      id: "source",
      name: "Source MP4",
      available: Boolean(source),
    },
    ...variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      available: resultsById.has(variant.id),
    })),
  ];
}

function getCompareChoice(choiceId) {
  if (choiceId === "source") {
    return {
      id: "source",
      name: "Source MP4",
      type: "source",
      available: Boolean(source),
      meta: source
        ? `${formatBytes(source.size)} / 1.00x MP4 / ${source.width} x ${source.height} / full quality video`
        : "Loading source video",
      placeholder: "Loading source video",
    };
  }

  const variant = variants.find((candidate) => candidate.id === choiceId);
  const result = resultsById.get(choiceId);
  if (!variant) {
    return {
      id: "source",
      name: "Source MP4",
      type: "source",
      available: Boolean(source),
      meta: source ? "full quality video" : "Loading source video",
      placeholder: "Loading source video",
    };
  }

  if (!result) {
    return {
      id: variant.id,
      name: variant.name,
      type: "gif",
      available: false,
      meta: variantSummary(variant),
      placeholder: "Waiting for benchmark result",
    };
  }

  const ratio = result.bytes / source.size;
  return {
    id: variant.id,
    name: variant.name,
    type: "gif",
    available: true,
    result,
    meta: `${formatBytes(result.bytes)} / ${formatNumber(ratio, 2)}x MP4 / ${result.width} x ${result.height} / ${ditherLabel(variant)}`,
    placeholder: "Waiting for benchmark result",
  };
}

function usesSpatialDither(variant) {
  return (
    variant.ditherMode === "spatial" ||
    variant.ditherMode === "spatial-temporal"
  );
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
