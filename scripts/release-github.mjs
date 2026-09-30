#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDraft,
  commitNotes,
  readVersion,
  releaseEvent,
  targets,
  verifyChecksums,
  writeChecksums,
} from "./release-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
if (!["validate", "draft"].includes(mode) || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("This script is restricted to the Release workflow (validate or draft).");
}
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || ""))
  throw new Error("Invalid workflow repository.");
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const commit = run("git", ["rev-parse", "HEAD"]);
if (commit !== process.env.GITHUB_SHA || run("git", ["status", "--porcelain"]))
  throw new Error("Expected a clean checkout of the workflow commit.");
const version = readVersion(root);
const tag = `v${version}`;
const autoPublish = releaseEvent(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF, tag);
function api(endpoint, optional = false) {
  try {
    return JSON.parse(run("gh", ["api", `repos/${repository}/${endpoint}`]));
  } catch (error) {
    if (optional && String(error.stderr).includes("HTTP 404")) return null;
    throw error;
  }
}
// Confirm access before treating any later 404 as a missing tag or release.
api("");
function existingRelease() {
  const release = api(`releases/tags/${tag}`, true);
  const reference = api(`git/ref/tags/${tag}`, true);
  const taggedCommit = reference ? api(`commits/${tag}`).sha : null;
  if (autoPublish && !taggedCommit)
    throw new Error("The pushed release tag is missing from the remote repository.");
  assertDraft(release && { isDraft: release.draft }, commit, taggedCommit);
  if (release && !taggedCommit && release.target_commitish !== commit) {
    throw new Error("Existing draft is not bound to this workflow commit.");
  }
  return release;
}
existingRelease();
if (mode === "validate") {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
} else {
  const out = path.join(root, "dist/release/upload");
  const expected = Object.entries(targets).filter(
    ([target]) => !target.includes("linux") || process.env.RELEASE_LINUX === "true",
  );
  const verified = new Set();
  for (const [target, { platform, extension }] of expected) {
    const checksum = `SHA256SUMS-${platform}.txt`;
    const files = verifyChecksums(out, checksum);
    const info = JSON.parse(fs.readFileSync(path.join(out, `BUILDINFO-${platform}.json`), "utf8"));
    if (
      info.commit !== commit ||
      info.version !== version ||
      info.target !== target ||
      info.platform !== platform ||
      info.updaterArtifacts !== false ||
      info.signing !== (platform.startsWith("darwin") ? "ad-hoc" : "none")
    ) {
      throw new Error(`Artifact source metadata differs for ${platform}.`);
    }
    if (
      !files.includes(`BUILDINFO-${platform}.json`) ||
      !files.includes("LICENSE") ||
      !files.includes("NOTICE") ||
      !files.includes(`ZyntaxAI_${version}_${platform}${extension}`) ||
      (target.includes("linux") && !files.includes(`ZyntaxAI_${version}_${platform}.deb`))
    ) {
      throw new Error(`Missing release files for ${platform}.`);
    }
    for (const file of [...files, checksum]) verified.add(file);
  }
  if (fs.readdirSync(out).some((file) => !verified.has(file)))
    throw new Error("Unexpected release artifact.");
  for (const file of ["LICENSE", "NOTICE"]) {
    if (!fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(out, file))))
      throw new Error(`Changed ${file} in release artifacts.`);
  }
  for (const [format, extension] of [
    ["zip", "zip"],
    ["tar.gz", "tar.gz"],
  ]) {
    run("git", [
      "archive",
      `--format=${format}`,
      `--prefix=ZyntaxAI-${version}/`,
      `--output=${path.join(out, `ZyntaxAI_${version}_source.${extension}`)}`,
      commit,
    ]);
  }
  const url = `https://github.com/${repository}`;
  // Use the nearest published release on this commit's ancestry, not an arbitrary local tag.
  const predecessors = [];
  for (let page = 1; ; page++) {
    const releases = api(`releases?per_page=100&page=${page}`);
    for (const previous of releases) {
      if (
        previous.draft ||
        previous.prerelease ||
        previous.tag_name === tag ||
        !/^v\d+\.\d+\.\d+$/.test(previous.tag_name)
      )
        continue;
      try {
        const base = run("git", ["rev-parse", `${previous.tag_name}^{commit}`]);
        run("git", ["merge-base", "--is-ancestor", base, commit]);
        predecessors.push({
          tag: previous.tag_name,
          distance: Number(run("git", ["rev-list", "--count", `${base}..${commit}`])),
        });
      } catch (error) {
        // A release on another branch is not the baseline for this release.
        if (error.status !== 1) throw error;
      }
    }
    if (releases.length < 100) break;
  }
  predecessors.sort((a, b) => a.distance - b.distance || a.tag.localeCompare(b.tag));
  const previousTag = predecessors[0]?.tag;
  const log = run("git", [
    "log",
    "--reverse",
    "--format=%H%x00%s",
    previousTag ? `${previousTag}..${commit}` : commit,
  ]);
  const changes = commitNotes(
    repository,
    log
      ? log.split("\n").map((line) => {
          const [hash, subject] = line.split("\0");
          return { hash, subject };
        })
      : [],
    previousTag,
    tag,
  );
  fs.writeFileSync(path.join(out, "COMMIT_CHANGES.md"), changes);
  const source =
    `# Corresponding source\n\nVersion: ${version}\nBuild commit: ${commit}\n\n` +
    `Source commit: ${url}/tree/${commit}\nRelease tag: ${url}/tree/${tag}\n\n` +
    `The attached ZyntaxAI_${version}_source.zip and .tar.gz contain this exact commit,\n` +
    `including build scripts, configuration and dependency lockfiles. See docs/RELEASING.md\n` +
    `and README.md in the archive for build instructions and dependency requirements.\n\n` +
    `Based on ZyntaxAI by TheHolyOneZ; this fork is maintained by kabeep.\n` +
    `GPL-3.0-or-later; distributed without warranty. See LICENSE, NOTICE and CHANGELOG.md.\n`;
  fs.writeFileSync(path.join(out, "SOURCE.md"), source);
  writeChecksums(out, fs.readdirSync(out), "SHA256SUMS.txt");
  const notesFile = path.join(root, "dist/release/notes.md");
  fs.writeFileSync(
    notesFile,
    `${process.env.RELEASE_NOTES || "See CHANGELOG.md for dated fork changes."}\n\n${changes}\n${source}\nInstallers have no platform-authority certificate; macOS uses ad-hoc signing. No updater artifacts are included.\n`,
  );
  const release = existingRelease();
  const assets = fs.readdirSync(out);
  if (release?.assets.some((asset) => !assets.includes(asset.name)))
    throw new Error("Existing draft has unexpected assets; review them before retrying.");
  if (!release) {
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--target",
      commit,
      "--title",
      `ZyntaxAI ${version} (fork)`,
      "--notes-file",
      notesFile,
      "--draft",
    ]);
  } else {
    run("gh", ["release", "edit", tag, "--repo", repository, "--notes-file", notesFile]);
  }
  // Recheck publication state immediately before allowing replacement of draft assets.
  existingRelease();
  run("gh", [
    "release",
    "upload",
    tag,
    "--repo",
    repository,
    ...assets.map((file) => path.join(out, file)),
    "--clobber",
  ]);
  if (autoPublish) {
    existingRelease();
    run("gh", ["release", "edit", tag, "--repo", repository, "--verify-tag", "--draft=false"]);
    console.log(`Release published at ${url}/releases/tag/${tag}.`);
  } else {
    console.log(`Draft prepared at ${url}/releases. Review it and publish manually.`);
  }
}
