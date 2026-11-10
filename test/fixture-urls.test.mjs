import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fixture URLs retain the deployment prefix at both root and project sites", async () => {
  const source = await readFile(
    new URL("../fixtures/index.js", import.meta.url),
    "utf8",
  );
  for (const prefix of ["", "gifenc/"]) {
    const moduleUrl = `https://example.com/${prefix}fixtures/index.js`;
    // Evaluate the actual module with its browser URL, without depending on a server.
    const { fixtureUrl, BENCH_VIDEO_FIXTURES, BENCH_IMAGE_FIXTURES } =
      await import(
        `data:text/javascript,${encodeURIComponent(source.replaceAll("import.meta.url", JSON.stringify(moduleUrl)))}`
      );
    for (const fixture of [
      ...BENCH_IMAGE_FIXTURES,
      ...Object.values(BENCH_VIDEO_FIXTURES),
    ]) {
      assert.equal(
        fixtureUrl(fixture),
        `https://example.com/${prefix}${fixture.repoPath}`,
      );
    }
  }
});
