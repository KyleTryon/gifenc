import test from "node:test";
import assert from "node:assert/strict";
import { publishPackage } from "../.github/scripts/publish-package.mjs";

function registry({ existing, viewError, publishError } = {}) {
  let published = existing;
  let publications = 0;
  const run = ([command]) => {
    if (command === "pack")
      return JSON.stringify([
        {
          name: "@test/gifenc",
          version: "2.0.0",
          filename: "package.tgz",
          integrity: "sha512-matching",
        },
      ]);
    if (command === "view") {
      if (viewError) throw viewError;
      if (published) return JSON.stringify(published);
      throw Object.assign(new Error("not found"), {
        stdout: JSON.stringify({ error: { code: "E404" } }),
      });
    }
    assert.equal(command, "publish");
    if (publishError) throw publishError;
    publications++;
    published = "sha512-matching";
    return "";
  };
  return { run, publications: () => publications };
}

test("publishing can resume after a later GitHub failure without republishing", () => {
  const npm = registry();
  publishPackage(npm.run);
  publishPackage(npm.run);
  assert.equal(npm.publications(), 1);
});

test("an existing version with different bytes cannot be claimed by a release", () => {
  const npm = registry({ existing: "sha512-different" });
  assert.throws(() => publishPackage(npm.run), /different contents/);
  assert.equal(npm.publications(), 0);
});

test("registry authentication, network errors, and publication failures stop release", () => {
  for (const viewError of [
    new Error("network unavailable"),
    Object.assign(new Error("unauthorized"), {
      stdout: JSON.stringify({ error: { code: "E401" } }),
    }),
  ]) {
    const npm = registry({ viewError });
    assert.throws(
      () => publishPackage(npm.run),
      (error) => error === viewError,
    );
    assert.equal(npm.publications(), 0);
  }
  const publishError = new Error("publish failed");
  assert.throws(
    () => publishPackage(registry({ publishError }).run),
    (error) => error === publishError,
  );
});
