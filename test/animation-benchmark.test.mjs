import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";

test("animation benchmark produces decodable, timed sequences", () => {
  const output = execFileSync(process.execPath, ["bench/node/animation.mjs"], {
    encoding: "utf8",
    env: { ...process.env, GIFENC_ANIMATION_ITERATIONS: "1" },
  });
  const report = JSON.parse(output);
  assert.deepEqual(
    report.results.map((result) => result.sequence),
    ["gradient", "motion", "scene-cut", "text", "alpha"],
  );
  for (const result of report.results) {
    assert.equal(result.duration_ms, 600);
    assert.ok(result.output_bytes > 0);
    assert.ok(Number.isFinite(result.rgb_rmse));
    assert.ok(Number.isFinite(result.temporal_error_rmse));
  }
});
