import {
  GIFEncoder,
  applyPalette,
  createTemporalDither,
  frameDelay,
  quantize,
  createPaletteSampler,
} from "../../dist/gifenc.mjs";
import { BENCH_VIDEO_FIXTURES, fixtureUrl } from "../../fixtures/index.js";

const SOURCE_VIDEO = BENCH_VIDEO_FIXTURES.basketball;
const SOURCE_URL = fixtureUrl(SOURCE_VIDEO);
const SOURCE_FPS = SOURCE_VIDEO.fps;
const BLANK_GIF_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const SKY_ROI = {
  x: 0.03,
  y: 0.05,
  width: 0.36,
  height: 0.21,
};
const SOFT_TEMPORAL_OPTIONS = {
  strength: 0.45,
  changeDetection: {
    pixelThreshold: 24,
  },
};

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
    id: "full-256-spatial-temporal-soft",
    name: "Full 256 spatial + temporal soft",
    scale: 1,
    fps: 24,
    colors: 256,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial-temporal",
    temporal: SOFT_TEMPORAL_OPTIONS,
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
    // Serpentine scanning is the default, so this variant turns it off to
    // show what the alternating scan direction buys.
    id: "balanced-128-spatial-raster",
    name: "Balanced 128 spatial raster",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial",
    serpentine: false,
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
    id: "balanced-128-spatial-temporal-soft",
    name: "Balanced 128 spatial + temporal soft",
    scale: 1,
    fps: 12,
    colors: 128,
    format: "rgb565",
    paletteStrategy: "frame",
    ditherMode: "spatial-temporal",
    temporal: SOFT_TEMPORAL_OPTIONS,
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
const copyButton = document.querySelector("#copy-button");
const sourceRoi = document.querySelector("#source-roi");
const statusText = document.querySelector("#status");
const progressBar = document.querySelector("#progress");
const sourceVideo = document.querySelector("#source-video");
const sourceMetrics = document.querySelector("#source-metrics");
const sourceUrl = document.querySelector("#source-url");
const resultsBody = document.querySelector("#results-body");
const resultsHead = document.querySelector("#results-head");
const tableFilter = document.querySelector("#table-filter");
const columnMenu = document.querySelector("#column-menu");
const columnMenuPanel = document.querySelector("#column-menu-panel");
const selectionSummary = document.querySelector("#selection-summary");
const compareSelectedButton = document.querySelector("#compare-selected");
const compareSection = document.querySelector(".compare-section");
const resultGrid = document.querySelector("#result-grid");
const compareLeftSelect = document.querySelector("#compare-left");
const compareRightSelect = document.querySelector("#compare-right");
const compareLeftPane = document.querySelector("#compare-left-pane");
const compareRightPane = document.querySelector("#compare-right-pane");

let source = null;
let sourceBlobUrl = "";
let decodedFrames = null;
let running = false;
let runningId = null;
let resultUrls = [];
let resultsById = new Map();
let compareSyncToken = 0;
const compareSelection = {
  left: "balanced-128-spatial",
  right: "balanced-128-spatial-temporal",
};

// Data table: column definitions drive the header, cells, sorting, the
// Columns menu, and best-value highlighting. Metric columns only have values
// once a variant has finished encoding.
const tableColumns = [
  {
    id: "name",
    header: "Output",
    hideable: false,
    value: (variant) => variant.name,
    cell: (variant) => variant.name,
    sourceCell: () => "Source MP4",
  },
  {
    id: "dimensions",
    header: "Dimensions",
    value: (variant) => variant.scale,
    cell: (variant, result) =>
      result
        ? `${result.width} x ${result.height}`
        : expectedDimensions(variant),
    sourceCell: () => `${source.width} x ${source.height}`,
  },
  {
    id: "frames",
    header: "Frames",
    numeric: true,
    value: (variant) => variant.fps,
    cell: (variant, result) =>
      result ? formatInteger(result.frameCount) : expectedFrames(variant),
    sourceCell: () => formatInteger(source.frameCount),
  },
  {
    id: "fps",
    header: "FPS",
    numeric: true,
    value: (variant) => variant.fps,
    cell: (variant) => variant.fps,
    sourceCell: () => source.fps,
  },
  {
    id: "palette",
    header: "Palette",
    value: (variant) => variant.colors,
    cell: (variant) =>
      `${variant.colors} colors, ${variant.format}, ${paletteLabel(variant)}`,
    sourceCell: () => "full quality video",
  },
  {
    id: "dither",
    header: "Dither",
    value: (variant) => ditherLabel(variant),
    cell: (variant) => ditherLabel(variant),
    sourceCell: () => "none",
  },
  {
    id: "size",
    header: "Size",
    numeric: true,
    metric: true,
    best: true,
    value: (variant, result) => result.bytes,
    cell: (variant, result) => formatBytes(result.bytes),
    sourceCell: () => formatBytes(source.size),
  },
  {
    id: "ratio",
    header: "vs MP4",
    numeric: true,
    metric: true,
    value: (variant, result) => result.bytes / source.size,
    cell: (variant, result) =>
      `${formatNumber(result.bytes / source.size, 2)}x`,
    sourceCell: () => "1.00x",
  },
  {
    id: "error",
    header: "Sky error",
    numeric: true,
    metric: true,
    best: true,
    value: (variant, result) => result.sky.error,
    cell: (variant, result) => formatSkyMetric(result.sky.error, 2),
    sourceCell: () => "n/a",
  },
  {
    id: "flicker",
    header: "Sky flicker",
    numeric: true,
    metric: true,
    best: true,
    value: (variant, result) => result.sky.flicker,
    cell: (variant, result) => formatSkyMetric(result.sky.flicker, 2),
    sourceCell: () => "n/a",
  },
  {
    id: "colors",
    header: "Sky colors",
    numeric: true,
    metric: true,
    value: (variant, result) => result.sky.uniqueColors,
    cell: (variant, result) => formatSkyMetric(result.sky.uniqueColors, 1),
    sourceCell: () => "n/a",
  },
  {
    id: "encode",
    header: "Encode time",
    numeric: true,
    metric: true,
    best: true,
    value: (variant, result) => result.encodeMs,
    cell: (variant, result) => `${formatNumber(result.encodeMs / 1000, 2)}s`,
    sourceCell: () => "n/a",
  },
  {
    id: "download",
    header: "Download",
    metric: true,
    sortable: false,
    markdown: false,
    cell: (variant, result) =>
      `<a class="download-link" href="${result.url}" download="${variant.id}.gif">Download</a>`,
    sourceCell: () => `<a class="download-link" href="${SOURCE_URL}">Open</a>`,
  },
];

const HIDDEN_COLUMNS_KEY = "gifenc-video-report-hidden-columns";
const tableState = {
  sort: null,
  filter: "",
  hidden: new Set(loadHiddenColumns()),
  selected: new Set(),
};

window.addEventListener("beforeunload", () => {
  revokeSourceBlobUrl();
});

init().catch((error) => {
  setStatus(`Could not load source video: ${error.message}`);
  console.error(error);
});

runButton.addEventListener("click", () => {
  runBenchmark().catch((error) => {
    running = false;
    runningId = null;
    runButton.disabled = !source;
    resetButton.disabled = false;
    renderTable();
    setStatus(`Benchmark failed: ${error.message}`);
    console.error(error);
  });
});

resetButton.addEventListener("click", () => {
  clearResults();
  decodedFrames = null;
  setProgress(0);
  setStatus(source ? "Ready." : "Loading source video...");
});

copyButton.addEventListener("click", () => {
  if (!navigator.clipboard) {
    setStatus("Copying needs a secure page (https or localhost).");
    return;
  }
  navigator.clipboard.writeText(resultsMarkdown()).then(
    () => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy as Markdown";
      }, 1500);
    },
    (error) => setStatus(`Could not copy results: ${error.message}`),
  );
});

resultsHead.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (button) toggleSort(button.dataset.sort);
});

resultsHead.addEventListener("change", (event) => {
  if (!event.target.matches("[data-select-all]")) return;
  for (const variant of displayedVariants()) {
    if (event.target.checked) tableState.selected.add(variant.id);
    else tableState.selected.delete(variant.id);
  }
  renderTable();
});

resultsBody.addEventListener("change", (event) => {
  const id = event.target.dataset.select;
  if (!id) return;
  if (event.target.checked) tableState.selected.add(id);
  else tableState.selected.delete(id);
  renderTable();
});

tableFilter.addEventListener("input", () => {
  tableState.filter = tableFilter.value;
  renderTable();
});

columnMenuPanel.addEventListener("change", (event) => {
  const id = event.target.dataset.column;
  if (!id) return;
  if (event.target.checked) tableState.hidden.delete(id);
  else tableState.hidden.add(id);
  if (tableState.sort?.id === id) tableState.sort = null;
  saveHiddenColumns();
  renderTable();
});

document.addEventListener("click", (event) => {
  if (columnMenu.open && !columnMenu.contains(event.target)) {
    columnMenu.open = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && columnMenu.open) {
    columnMenu.open = false;
    columnMenu.querySelector("summary").focus();
  }
});

compareSelectedButton.addEventListener("click", compareSelectedRows);

compareLeftSelect.addEventListener("change", () => {
  compareSelection.left = compareLeftSelect.value;
  renderComparison();
});

compareRightSelect.addEventListener("change", () => {
  compareSelection.right = compareRightSelect.value;
  renderComparison();
});

async function init() {
  renderColumnMenu();
  clearResults();
  sourceUrl.textContent = SOURCE_VIDEO.repoPath.split("/").pop();
  sourceUrl.href = SOURCE_URL;

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const sourceBlob = await response.blob();
  setSourceBlobUrl(sourceBlob);
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
  renderTable();
  renderCompareOptions();
  renderComparison();
  runButton.disabled = false;
  setStatus("Ready.");
}

async function runBenchmark() {
  if (!source || running) return;

  running = true;
  runButton.disabled = true;
  // Reset drops the decoded frames, which the encode loop below still needs.
  resetButton.disabled = true;
  clearResults();
  setProgress(0);
  const started = performance.now();

  decodedFrames ??= await decodeSourceFrames(sourceBlobUrl, source);

  for (const [index, variant] of variants.entries()) {
    runningId = variant.id;
    renderTable();
    setStatus(
      `Encoding ${index + 1} of ${variants.length}: ${variant.name}...`,
    );
    const progressOffset = 10 + (index / variants.length) * 90;
    const progressSpan = 90 / variants.length;
    const result = await encodeVariant(source, decodedFrames, variant, (part) =>
      setProgress(progressOffset + part * progressSpan),
    );

    renderVariantResult(source, variant, result);
    await yieldToBrowser();
  }

  runningId = null;
  renderTable();
  setProgress(100);
  setStatus(
    `Benchmark complete in ${formatNumber((performance.now() - started) / 1000, 1)}s.`,
  );
  running = false;
  runButton.disabled = false;
  resetButton.disabled = false;
  copyButton.disabled = false;
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
  const { width, height, frameCount } = variantOutputSize(metadata, variant);
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

  let sharedPalette = null;
  if (variant.paletteStrategy === "shared") {
    const maxSamples = 120_000;
    const sampler = createPaletteSampler(
      maxSamples,
      Math.max(1, Math.floor(maxSamples / selectedFrames.length)),
    );
    for (const frame of selectedFrames) sampler.addFrame(frame);
    sharedPalette = sampler.quantize(variant.colors, {
      format: variant.format,
    });
  }

  onProgress(0.25);

  const temporalDither =
    variant.ditherMode === "spatial-temporal"
      ? createTemporalDither({
          width,
          height,
          format: variant.format,
          ...variant.temporal,
        })
      : null;
  const skyDiagnostics = createSkyDiagnostics(width, height);
  const encoder = GIFEncoder();

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
            ditherStrength: variant.ditherStrength,
            serpentine: variant.serpentine,
            width,
            height,
            temporalDither,
          }
        : variant.format,
    );
    recordSkyDiagnostics(skyDiagnostics, rgba, palette, index);

    encoder.writeFrame(index, width, height, {
      delay: frameDelay(
        (i * 1000) / variant.fps,
        ((i + 1) * 1000) / variant.fps,
      ),
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
    sky: finalizeSkyDiagnostics(skyDiagnostics),
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

function renderSourceMetrics(metadata) {
  sourceMetrics.innerHTML = "";
  const roi = resolveSkyRoi(metadata.width, metadata.height);
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
    ["Sky ROI", `${roi.width} x ${roi.height} at ${roi.x}, ${roi.y}`],
  ];

  for (const [label, value] of metrics) {
    sourceMetrics.append(createMetric(label, value));
  }

  sourceRoi.style.left = `${(roi.x / metadata.width) * 100}%`;
  sourceRoi.style.top = `${(roi.y / metadata.height) * 100}%`;
  sourceRoi.style.width = `${(roi.width / metadata.width) * 100}%`;
  sourceRoi.style.height = `${(roi.height / metadata.height) * 100}%`;
  sourceRoi.hidden = false;

  // Media frames take the source's shape so the ROI box, which is positioned
  // as a share of the frame, lines up with the pixels it measures.
  document.documentElement.style.setProperty(
    "--source-aspect",
    `${metadata.width} / ${metadata.height}`,
  );
}

function renderTable() {
  const focusKey = document.activeElement?.dataset?.focusKey;
  const columns = visibleColumns();
  const rows = displayedVariants();
  const best = bestValues();
  const selectedVisible = rows.filter((variant) =>
    tableState.selected.has(variant.id),
  ).length;

  resultsHead.innerHTML = `<tr>
    <th class="col-select" scope="col">
      <input type="checkbox" data-select-all data-focus-key="select-all"
        aria-label="Select all outputs"
        ${rows.length > 0 && selectedVisible === rows.length ? "checked" : ""} />
    </th>
    ${columns.map(headerCell).join("")}
  </tr>`;
  resultsHead.querySelector("[data-select-all]").indeterminate =
    selectedVisible > 0 && selectedVisible < rows.length;

  const body = [];
  if (source) {
    body.push(`<tr class="reference">
      <td class="col-select"></td>
      ${columns.map((column) => bodyCell(column, column.sourceCell())).join("")}
    </tr>`);
  }
  for (const variant of rows) {
    body.push(variantRow(variant, columns, best));
  }
  if (rows.length === 0) {
    body.push(`<tr><td class="pending" colspan="${columns.length + 1}">
      No outputs match the filter.
    </td></tr>`);
  }
  resultsBody.innerHTML = body.join("");

  const shown =
    rows.length === variants.length
      ? `${variants.length} outputs`
      : `Showing ${rows.length} of ${variants.length} outputs`;
  selectionSummary.textContent = `${shown}. ${selectedVisible} selected.`;
  compareSelectedButton.disabled = selectedVisible !== 2;
  compareSelectedButton.title =
    selectedVisible === 2 ? "" : "Select exactly two outputs to compare";

  if (focusKey) {
    document
      .querySelector(`[data-focus-key="${focusKey}"]`)
      ?.focus({ preventScroll: true });
  }
}

function headerCell(column) {
  const className = columnClass(column);
  if (column.sortable === false) {
    return `<th class="${className}" scope="col">${column.header}</th>`;
  }
  const sort = tableState.sort;
  const direction =
    sort?.id === column.id ? (sort.desc ? "descending" : "ascending") : "";
  const icon =
    direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕";
  return `<th class="${className}" scope="col"${direction ? ` aria-sort="${direction}"` : ""}>
    <button class="sort-button" type="button" data-sort="${column.id}"
      data-focus-key="sort-${column.id}">
      ${column.header}<span class="sort-icon" aria-hidden="true">${icon}</span>
    </button>
  </th>`;
}

function variantRow(variant, columns, best) {
  const result = resultsById.get(variant.id);
  const selected = tableState.selected.has(variant.id);
  const isRunning = variant.id === runningId;
  const cells = [];
  let pendingSpan = 0;

  for (const column of columns) {
    if (column.metric && !result) {
      pendingSpan++;
      continue;
    }
    const isBest =
      result &&
      column.best &&
      column.value(variant, result) === best[column.id];
    const text = column.cell(variant, result);
    cells.push(
      bodyCell(column, isBest ? `<span class="best">${text}</span>` : text),
    );
  }
  if (pendingSpan > 0) {
    cells.push(
      `<td class="pending" colspan="${pendingSpan}">${isRunning ? "Encoding..." : "Queued"}</td>`,
    );
  }

  return `<tr class="${isRunning ? "running" : ""}"${selected ? ' data-state="selected"' : ""}>
    <td class="col-select">
      <input type="checkbox" data-select="${variant.id}"
        data-focus-key="select-${variant.id}"
        aria-label="Select ${variant.name}"${selected ? " checked" : ""} />
    </td>
    ${cells.join("")}
  </tr>`;
}

function bodyCell(column, content) {
  return `<td class="${columnClass(column)}">${content}</td>`;
}

function columnClass(column) {
  return `col-${column.id}${column.numeric ? " num" : ""}`;
}

function visibleColumns() {
  return tableColumns.filter((column) => !tableState.hidden.has(column.id));
}

function displayedVariants() {
  const query = tableState.filter.trim().toLowerCase();
  const rows = variants.filter(
    (variant) => !query || variantSearchText(variant).includes(query),
  );
  const sort = tableState.sort;
  if (!sort) return rows;

  const column = tableColumns.find((candidate) => candidate.id === sort.id);
  const direction = sort.desc ? -1 : 1;
  return rows
    .map((variant, index) => {
      const result = resultsById.get(variant.id);
      const value =
        column.metric && !result ? null : column.value(variant, result);
      return { variant, index, value };
    })
    .sort((a, b) => {
      // Unfinished rows have no metric values; keep them last either way.
      if (a.value == null || b.value == null) {
        if (a.value == null && b.value == null) return a.index - b.index;
        return a.value == null ? 1 : -1;
      }
      const diff =
        typeof a.value === "string"
          ? a.value.localeCompare(b.value)
          : a.value - b.value;
      return diff * direction || a.index - b.index;
    })
    .map((entry) => entry.variant);
}

function variantSearchText(variant) {
  return [
    variant.name,
    `${variant.colors} colors`,
    variant.format,
    paletteLabel(variant),
    ditherLabel(variant),
  ]
    .join(" ")
    .toLowerCase();
}

function bestValues() {
  const finished = variants.filter((variant) => resultsById.has(variant.id));
  if (finished.length < 2) return {};
  const best = {};
  for (const column of tableColumns) {
    if (!column.best) continue;
    best[column.id] = Math.min(
      ...finished.map((variant) =>
        column.value(variant, resultsById.get(variant.id)),
      ),
    );
  }
  return best;
}

function toggleSort(columnId) {
  const sort = tableState.sort;
  if (sort?.id !== columnId) {
    tableState.sort = { id: columnId, desc: false };
  } else if (!sort.desc) {
    tableState.sort = { id: columnId, desc: true };
  } else {
    tableState.sort = null;
  }
  renderTable();
}

function renderColumnMenu() {
  columnMenuPanel.innerHTML = tableColumns
    .filter((column) => column.hideable !== false)
    .map(
      (column) => `<label>
        <input type="checkbox" data-column="${column.id}"
          ${tableState.hidden.has(column.id) ? "" : "checked"} />
        ${column.header}
      </label>`,
    )
    .join("");
}

function loadHiddenColumns() {
  try {
    const stored = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function saveHiddenColumns() {
  try {
    localStorage.setItem(
      HIDDEN_COLUMNS_KEY,
      JSON.stringify([...tableState.hidden]),
    );
  } catch {
    // Storage can be unavailable; column choices then last for this visit.
  }
}

function compareSelectedRows() {
  const [left, right] = displayedVariants()
    .filter((variant) => tableState.selected.has(variant.id))
    .map((variant) => variant.id);
  if (!left || !right) return;
  compareSelection.left = left;
  compareSelection.right = right;
  renderCompareOptions();
  renderComparison();
  compareSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function variantOutputSize(metadata, variant) {
  return {
    width: Math.max(1, Math.round(metadata.width * variant.scale)),
    height: Math.max(1, Math.round(metadata.height * variant.scale)),
    frameCount: Math.round(metadata.duration * variant.fps),
  };
}

function expectedDimensions(variant) {
  if (!source) return "";
  const { width, height } = variantOutputSize(source, variant);
  return `${width} x ${height}`;
}

function expectedFrames(variant) {
  return source
    ? formatInteger(variantOutputSize(source, variant).frameCount)
    : "";
}

// Copies what the table shows: the visible columns, in the current order,
// for the finished outputs that pass the filter.
function resultsMarkdown() {
  const columns = visibleColumns().filter(
    (column) => column.markdown !== false,
  );
  const rows = displayedVariants().filter((variant) =>
    resultsById.has(variant.id),
  );
  const lines = [
    `### gifenc video benchmark (${SOURCE_VIDEO.name})`,
    "",
    `Source: ${source.width} x ${source.height}, ${source.fps} fps, ${formatBytes(source.size)}. Browser: ${navigator.userAgent}, ${navigator.hardwareConcurrency} logical cores.`,
    "",
  ];
  if (rows.length < resultsById.size) {
    lines.push(
      `Filtered by "${tableState.filter.trim()}": ${rows.length} of ${resultsById.size} outputs.`,
      "",
    );
  }
  lines.push(
    `| ${columns.map((column) => column.header).join(" | ")} |`,
    `| ${columns.map((column) => (column.numeric ? "---:" : "---")).join(" | ")} |`,
  );
  for (const variant of rows) {
    const result = resultsById.get(variant.id);
    lines.push(
      `| ${columns.map((column) => column.cell(variant, result)).join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderVariantResult(metadata, variant, result) {
  resultsById.set(variant.id, result);
  renderTable();

  const card =
    resultGrid.querySelector(`[data-variant-id="${variant.id}"]`) ??
    document.createElement("article");
  card.className = "result-card";
  card.dataset.variantId = variant.id;
  card.innerHTML = `
    <h3>${variant.name}</h3>
    <p class="result-meta">
      ${resultMeta(metadata, variant, result)}
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
  copyButton.disabled = true;
  renderTable();
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
    return joinLabels([
      "spatial Floyd-Steinberg",
      variant.serpentine === false ? "raster scan" : "",
      ditherStrengthLabel(variant),
    ]);
  }
  if (variant.ditherMode === "spatial-temporal") {
    return joinLabels([
      "spatial Floyd-Steinberg + temporal dithering",
      variant.serpentine === false ? "raster scan" : "",
      ditherStrengthLabel(variant),
      temporalSettingsLabel(variant),
    ]);
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
  scheduleCompareGifSync();
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
  image.dataset.gifSrc = choice.result.url;
  image.alt = `${choice.name} GIF comparison preview`;
  mediaFrame.append(image);
}

function scheduleCompareGifSync() {
  const token = ++compareSyncToken;
  const images = [
    ...compareLeftPane.querySelectorAll("img[data-gif-src]"),
    ...compareRightPane.querySelectorAll("img[data-gif-src]"),
  ];

  if (images.length < 2) return;

  Promise.all(images.map(waitForImageReady)).then(() => {
    if (token !== compareSyncToken) return;

    requestAnimationFrame(() => {
      if (token !== compareSyncToken) return;

      const sources = images.map((image) => image.dataset.gifSrc ?? image.src);
      for (const image of images) {
        image.src = BLANK_GIF_URL;
      }

      requestAnimationFrame(() => {
        if (token !== compareSyncToken) return;
        for (let i = 0; i < images.length; i++) {
          const source = sources[i];
          if (source) images[i].src = source;
        }
      });
    });
  });
}

function waitForImageReady(image) {
  if (image.complete && image.naturalWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => {
      image.removeEventListener("load", done);
      image.removeEventListener("error", done);
      resolve();
    };
    image.addEventListener("load", done);
    image.addEventListener("error", done);
  });
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

  return {
    id: variant.id,
    name: variant.name,
    type: "gif",
    available: true,
    result,
    meta: resultMeta(source, variant, result),
    placeholder: "Waiting for benchmark result",
  };
}

function usesSpatialDither(variant) {
  return (
    variant.ditherMode === "spatial" ||
    variant.ditherMode === "spatial-temporal"
  );
}

function createSkyDiagnostics(width, height) {
  return {
    roi: resolveSkyRoi(width, height),
    frames: 0,
    totalError: 0,
    totalPixels: 0,
    totalResidualDelta: 0,
    residualSamples: 0,
    totalUniqueColors: 0,
    previousResiduals: null,
  };
}

function recordSkyDiagnostics(stats, rgba, palette, index) {
  const { x, y, width, height } = stats.roi;
  const residuals = new Float32Array(width * height * 3);
  const uniqueColors = new Set();
  let residualOffset = 0;

  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      const pixelIndex = row * stats.roi.frameWidth + column;
      const sourceOffset = pixelIndex * 4;
      const color = palette[index[pixelIndex]];
      const sr = rgba[sourceOffset];
      const sg = rgba[sourceOffset + 1];
      const sb = rgba[sourceOffset + 2];
      const er = color?.[0] ?? 0;
      const eg = color?.[1] ?? 0;
      const eb = color?.[2] ?? 0;
      const rr = er - sr;
      const rg = eg - sg;
      const rb = eb - sb;

      stats.totalError += Math.hypot(rr, rg, rb);
      stats.totalPixels++;
      uniqueColors.add(`${er},${eg},${eb}`);
      residuals[residualOffset++] = rr;
      residuals[residualOffset++] = rg;
      residuals[residualOffset++] = rb;
    }
  }

  if (stats.previousResiduals) {
    for (let i = 0; i < residuals.length; i += 3) {
      const rr = residuals[i] - stats.previousResiduals[i];
      const rg = residuals[i + 1] - stats.previousResiduals[i + 1];
      const rb = residuals[i + 2] - stats.previousResiduals[i + 2];
      stats.totalResidualDelta += Math.hypot(rr, rg, rb);
      stats.residualSamples++;
    }
  }

  stats.previousResiduals = residuals;
  stats.totalUniqueColors += uniqueColors.size;
  stats.frames++;
}

function finalizeSkyDiagnostics(stats) {
  return {
    error: average(stats.totalError, stats.totalPixels),
    flicker: average(stats.totalResidualDelta, stats.residualSamples),
    uniqueColors: average(stats.totalUniqueColors, stats.frames),
    roi: stats.roi,
  };
}

function resolveSkyRoi(width, height) {
  const x = Math.max(0, Math.round(width * SKY_ROI.x));
  const y = Math.max(0, Math.round(height * SKY_ROI.y));
  const roiWidth = Math.max(1, Math.round(width * SKY_ROI.width));
  const roiHeight = Math.max(1, Math.round(height * SKY_ROI.height));
  return {
    x,
    y,
    width: Math.min(roiWidth, width - x),
    height: Math.min(roiHeight, height - y),
    frameWidth: width,
    frameHeight: height,
  };
}

function average(total, count) {
  return count > 0 ? total / count : 0;
}

function resultMeta(metadata, variant, result) {
  const ratio = result.bytes / metadata.size;
  return `${formatBytes(result.bytes)} / ${formatNumber(ratio, 2)}x MP4 / ${result.width} x ${result.height} / ${ditherLabel(variant)} / sky ${formatSkyDiagnostics(result.sky)}`;
}

function formatSkyDiagnostics(sky) {
  return `error ${formatSkyMetric(sky.error, 2)}, flicker ${formatSkyMetric(sky.flicker, 2)}, colors ${formatSkyMetric(sky.uniqueColors, 1)}`;
}

function formatSkyMetric(value, digits) {
  return Number.isFinite(value) ? formatNumber(value, digits) : "n/a";
}

function ditherStrengthLabel(variant) {
  if (variant.ditherStrength == null || variant.ditherStrength === 1) {
    return "";
  }
  return `spatial strength ${formatNumber(variant.ditherStrength, 2)}`;
}

function temporalSettingsLabel(variant) {
  if (!variant.temporal) return "";
  const settings = [];
  if (variant.temporal.strength != null) {
    settings.push(`strength ${formatNumber(variant.temporal.strength, 2)}`);
  }
  if (variant.temporal.changeDetection?.pixelThreshold != null) {
    settings.push(
      `change ${formatNumber(
        variant.temporal.changeDetection.pixelThreshold,
        0,
      )}`,
    );
  }
  return settings.length ? `temporal ${settings.join(", ")}` : "";
}

function joinLabels(labels) {
  return labels.filter(Boolean).join(", ");
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

function setSourceBlobUrl(blob) {
  revokeSourceBlobUrl();
  sourceBlobUrl = URL.createObjectURL(blob);
}

function revokeSourceBlobUrl() {
  if (!sourceBlobUrl) return;
  URL.revokeObjectURL(sourceBlobUrl);
  sourceBlobUrl = "";
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
