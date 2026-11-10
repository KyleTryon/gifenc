import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const npm = (args) =>
  execFileSync("npm", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

// Only a registry E404 means the version is available. Authentication failures,
// outages, and an existing version with different bytes must stop the release.
export function publishPackage(run = npm) {
  const directory = mkdtempSync(join(tmpdir(), "gifenc-publish-"));
  try {
    const [packed] = JSON.parse(
      run([
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        directory,
      ]),
    );
    const spec = `${packed.name}@${packed.version}`;
    let publishedIntegrity;
    try {
      publishedIntegrity = JSON.parse(
        run(["view", spec, "dist.integrity", "--json"]),
      );
      if (typeof publishedIntegrity !== "string")
        throw new Error(`Missing integrity for ${spec}`);
    } catch (error) {
      let registryError;
      try {
        registryError = JSON.parse(String(error.stdout)).error;
      } catch {
        throw error;
      }
      if (registryError?.code !== "E404") throw error;
    }
    if (publishedIntegrity) {
      if (publishedIntegrity !== packed.integrity)
        throw new Error(
          `${spec} is already published with different contents; refusing to overwrite or tag it`,
        );
      console.log(
        `${spec} already published with matching integrity; resuming GitHub release`,
      );
      return;
    }
    run([
      "publish",
      join(directory, packed.filename),
      "--ignore-scripts",
      "--access",
      "public",
      "--tag",
      packed.version.includes("-") ? "next" : "latest",
    ]);
    console.log(`Published ${spec}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  publishPackage();
