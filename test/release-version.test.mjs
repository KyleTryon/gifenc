import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("release bumps follow conventional commits and stop after tagging", () => {
  const directory = mkdtempSync(join(tmpdir(), "gifenc-release-git-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const commit = (message) =>
    git(
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      message,
    );
  const determine = () =>
    Object.fromEntries(
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL(
              "../.github/scripts/determine-release-bump.mjs",
              import.meta.url,
            ),
          ),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GITHUB_OUTPUT: "" },
        },
      )
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
  try {
    git("init");
    commit("chore: initial");
    git("tag", "v1.0.0");
    assert.equal(determine().release_needed, "false");
    commit("docs: explain encoder");
    assert.equal(determine().release_needed, "false");
    commit("fix(encoder): reject invalid indexes");
    assert.equal(determine().bump, "patch");
    commit("feat(palette): add a mapping mode");
    assert.equal(determine().bump, "minor");
    commit(
      "fix(encoder): validate frames\n\nBREAKING CHANGE: invalid frames now throw",
    );
    assert.equal(determine().bump, "major");
    git("tag", "v2.0.0");
    assert.equal(determine().release_needed, "false");
    commit("fix(encoder)!: require integer dimensions");
    assert.equal(determine().bump, "major");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
