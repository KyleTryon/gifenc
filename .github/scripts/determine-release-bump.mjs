import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const bumpPriority = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function bumpForLine(line) {
  if (/^[a-z]+(?:\([^)]+\))?!:/.test(line)) {
    return "major";
  }

  if (/^(?:major)(?:\([^)]+\))?:/.test(line)) {
    return "major";
  }

  if (/^(?:feat|minor)(?:\([^)]+\))?:/.test(line)) {
    return "minor";
  }

  if (/^(?:fix|perf|security|patch)(?:\([^)]+\))?:/.test(line)) {
    return "patch";
  }

  return "none";
}

function bumpForCommit(subject, body) {
  const message = `${subject}\n${body}`;
  if (/^BREAKING[ -]CHANGE:/m.test(message)) {
    return "major";
  }

  return [subject, ...body.split(/\r?\n/)]
    .map((line) => bumpForLine(line.trim()))
    .reduce((highest, bump) => {
      return bumpPriority[bump] > bumpPriority[highest] ? bump : highest;
    }, "none");
}

const latestTag = git([
  "describe",
  "--tags",
  "--match",
  "v[0-9]*",
  "--abbrev=0",
]);
const range = latestTag ? `${latestTag}..HEAD` : "HEAD";
const rawLog = execFileSync(
  "git",
  ["log", "--format=%H%x00%s%x00%b%x1e", range],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
).trim();
const commits = rawLog
  .split("\x1e")
  .map((record) => record.trim())
  .filter(Boolean)
  .map((record) => {
    const [, subject, body = ""] = record.split("\x00");
    return { subject, body };
  });

const bump = commits
  .map(({ subject, body }) => bumpForCommit(subject, body))
  .reduce((highest, commitBump) => {
    return bumpPriority[commitBump] > bumpPriority[highest]
      ? commitBump
      : highest;
  }, "none");

const outputs = {
  release_needed: bump !== "none",
  bump,
  latest_tag: latestTag,
  commit_count: commits.length,
  range,
};

const output = Object.entries(outputs)
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
} else {
  console.log(output);
}
