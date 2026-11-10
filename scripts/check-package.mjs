import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "gifenc-package-"));
try {
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        directory,
        "--cache",
        join(directory, "cache"),
      ],
      { encoding: "utf8" },
    ),
  );
  const packagePath = join(directory, "node_modules", packed.name);
  mkdirSync(dirname(packagePath), { recursive: true });
  execFileSync("tar", [
    "-xzf",
    join(directory, packed.filename),
    "-C",
    directory,
  ]);
  renameSync(join(directory, "package"), packagePath);
  for (const file of [
    "dist/gifenc.mjs",
    "dist/gifenc.cjs",
    "dist/index.d.ts",
    "README.md",
    "LICENSE.md",
  ]) {
    assert.ok(
      packed.files.some((entry) => entry.path === file),
      `Missing ${file}`,
    );
  }
  const esm = await import(
    pathToFileURL(join(packagePath, "dist/gifenc.mjs")).href
  );
  const cjs = createRequire(join(directory, "consumer.cjs"))(packed.name);
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { GIFEncoder } from ${JSON.stringify(packed.name)}; if (typeof GIFEncoder !== "function") process.exit(1);`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  for (const api of [esm, cjs]) {
    const gif = api.GIFEncoder();
    gif.writeFrame(new Uint8Array([0]), 1, 1, { palette: [[1, 2, 3]] });
    gif.finish();
    assert.equal(Buffer.from(gif.bytes().subarray(0, 6)).toString(), "GIF89a");
    assert.equal(gif.bytes().at(-1), 0x3b);
  }
  const consumer = `import { GIFEncoder, type Palette } from ${JSON.stringify(packed.name)};\nconst palette: Palette = [[1,2,3]];\nGIFEncoder().writeFrame(new Uint8Array([0]),1,1,{palette});\n`;
  for (const extension of ["mts", "cts"])
    writeFileSync(join(directory, `consumer.${extension}`), consumer);
  const tsc = resolve("node_modules/typescript/bin/tsc");
  execFileSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2020",
      join(directory, "consumer.mts"),
      join(directory, "consumer.cts"),
    ],
    { cwd: directory, stdio: "inherit" },
  );
  assert.equal(
    JSON.parse(readFileSync(join(packagePath, "package.json"), "utf8")).version,
    packed.version,
  );
  console.log(
    `Validated ${packed.name}@${packed.version}: packed ESM, CommonJS, and consumer types`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
