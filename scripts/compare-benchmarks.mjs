import { readFile } from "node:fs/promises";

const [baselineFile, candidateFile, metric = "mean_ms"] = process.argv.slice(2);
const VALID_METRICS = new Set(["mean_ms", "median_ms", "min_ms", "max_ms"]);

if (!baselineFile || !candidateFile || !VALID_METRICS.has(metric)) {
  console.error(
    "Usage: node scripts/compare-benchmarks.mjs <baseline.txt> <candidate.txt> [mean_ms|median_ms|min_ms|max_ms]",
  );
  process.exit(1);
}

const baseline = parseBenchmark(await readFile(baselineFile, "utf8"));
const candidate = parseBenchmark(await readFile(candidateFile, "utf8"));

console.log(
  `| Fixture | Format | Stage | Baseline ${metric} | Candidate ${metric} | Speedup |`,
);
console.log("| --- | --- | --- | ---: | ---: | ---: |");

for (const row of baseline.rows) {
  const next = candidate.byKey.get(row.key);
  if (!next) continue;

  const before = row.metrics[metric];
  const after = next.metrics[metric];
  const speedup = before / after;
  console.log(
    `| ${row.fixture} | ${row.format} | ${row.stage} | ${formatMs(
      before,
    )} | ${formatMs(after)} | ${formatSpeedup(speedup)} |`,
  );
}

function parseBenchmark(text) {
  const rows = [];
  const byKey = new Map();
  let fixture = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("$") || line.startsWith("⚡")) continue;
    if (line.startsWith("format,stage,")) continue;

    const columns = line.split(",");
    if (columns.length === 8) {
      const [format, stage, iterations, mean, median, min, max, outputBytes] =
        columns;
      const row = {
        key: `${fixture}|${format}|${stage}`,
        fixture,
        format,
        stage,
        iterations: Number(iterations),
        outputBytes: Number(outputBytes),
        metrics: {
          mean_ms: Number(mean),
          median_ms: Number(median),
          min_ms: Number(min),
          max_ms: Number(max),
        },
      };
      rows.push(row);
      byKey.set(row.key, row);
    } else {
      fixture = line;
    }
  }

  return { rows, byKey };
}

function formatMs(value) {
  return `${value.toFixed(3)} ms`;
}

function formatSpeedup(value) {
  return `${value.toFixed(2)}x`;
}
