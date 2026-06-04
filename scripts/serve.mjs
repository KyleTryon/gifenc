import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5000);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".ts", "text/plain; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const url = new URL(
    request.url,
    `http://${request.headers.host ?? "localhost"}`,
  );
  const pathname = decodeURIComponent(url.pathname);
  const file = await resolveFile(pathname);

  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type":
      contentTypes.get(extname(file)) ?? "application/octet-stream",
  });
  createReadStream(file).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${String(port)}/`);
});

async function resolveFile(pathname) {
  const relativePath = normalize(pathname).replace(/^[/\\]+/, "");
  const candidate = resolve(root, relativePath);
  if (!isInsideRoot(candidate)) return null;

  const file = await findReadableFile(candidate);
  if (file) return file;

  const indexFile = await findReadableFile(join(candidate, "index.html"));
  return indexFile;
}

async function findReadableFile(file) {
  try {
    const info = await stat(file);
    return info.isFile() ? file : null;
  } catch {
    return null;
  }
}

function isInsideRoot(file) {
  return file === root || file.startsWith(`${root}${sep}`);
}
