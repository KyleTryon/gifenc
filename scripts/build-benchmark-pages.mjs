import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = join(root, "_site");

await rm(site, { recursive: true, force: true });

await copyFile("dist/gifenc.mjs");
await copyFile("dist/gifenc.mjs.map");
await copyDirectory("bench/video-report");
await copyDirectory("bench/fixtures");

await writeFile(join(site, ".nojekyll"), "", "utf8");

await writeFile(
  join(site, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=./bench/video-report/" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>gifenc benchmark report</title>
  </head>
  <body>
    <p><a href="./bench/video-report/">Open the video GIF benchmark report</a></p>
  </body>
</html>
`,
  "utf8",
);

async function copyFile(relativePath) {
  const target = join(site, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, relativePath), target);
}

async function copyDirectory(relativePath) {
  const target = join(site, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await cp(join(root, relativePath), target, {
    recursive: true,
  });
}
