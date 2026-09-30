import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function isStableVersion(version) {
  if (typeof version !== "string") return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return match?.[0] === version;
}

export function isVersionBump(message) {
  const text = message.replace(/\r?\n$/, "");
  return text.startsWith("Bump version ") && isStableVersion(text.slice("Bump version ".length));
}

export function assertReleaseVersion(message, version, previousVersion) {
  if (!isVersionBump(message) || message.replace(/\r?\n$/, "") !== `Bump version ${version}`) {
    throw new Error("Release commit must be exactly Bump version <metadata version>.");
  }
  if (!isStableVersion(previousVersion)) throw new Error("Invalid previous stable version.");
  const [major, minor, patch] = version.split(".").map(BigInt);
  const [oldMajor, oldMinor, oldPatch] = previousVersion.split(".").map(BigInt);
  const valid =
    (major > oldMajor && minor === 0n && patch === 0n) ||
    (major === oldMajor && minor > oldMinor && patch === 0n) ||
    (major === oldMajor && minor === oldMinor && patch > oldPatch);
  if (!valid)
    throw new Error(
      "Version must increase; reset patch for a minor bump and minor/patch for a major bump.",
    );
}

export const targets = {
  "x86_64-pc-windows-msvc": {
    platform: "windows-x86_64",
    bundles: "nsis",
    extension: "-setup.exe",
  },
  "aarch64-apple-darwin": { platform: "darwin-aarch64", bundles: "dmg", extension: ".dmg" },
  "x86_64-apple-darwin": { platform: "darwin-x86_64", bundles: "dmg", extension: ".dmg" },
  "x86_64-unknown-linux-gnu": {
    platform: "linux-x86_64",
    bundles: "deb,appimage",
    extension: ".AppImage",
  },
};

export function readVersion(root) {
  const versions = ["package.json", "apps/desktop/package.json", "src-tauri/tauri.conf.json"].map(
    (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")).version,
  );
  const cargo = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
  versions.push(cargo.match(/\[workspace\.package\][\s\S]*?\bversion\s*=\s*"([^"]+)"/)?.[1]);
  if (!isStableVersion(versions[0]) || versions.some((version) => version !== versions[0])) {
    throw new Error(
      "Release requires matching numeric major.minor.patch versions in package, desktop, Tauri and Cargo metadata.",
    );
  }
  return versions[0];
}

export function assertDraft(release, commit, taggedCommit) {
  if (release && !release.isDraft) throw new Error("Refusing to modify a published release.");
  if (taggedCommit && taggedCommit !== commit)
    throw new Error("The release tag points to a different source commit.");
}

export function releaseEvent(event, ref, tag) {
  if (event === "workflow_dispatch") return false;
  if (event !== "push" || ref !== `refs/tags/${tag}`) {
    throw new Error(
      "Automatic release requires a pushed version tag matching all version metadata.",
    );
  }
  return true;
}

export function commitNotes(repository, records, previousTag, tag) {
  const escape = (text) => text.replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&");
  const url = `https://github.com/${repository}`;
  const lines = records.map(
    ({ hash, subject }) => `- ${escape(subject)} ([${hash.slice(0, 7)}](${url}/commit/${hash}))`,
  );
  return (
    `## Commit changes\n\n${previousTag ? `Changes since ${escape(previousTag)}.` : "First release: complete commit history through this version."}\n\n` +
    `${lines.length ? lines.join("\n") : "No new commits."}\n` +
    (previousTag ? `\n[Full diff](${url}/compare/${previousTag}...${tag})\n` : "")
  );
}

export function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function writeChecksums(directory, names, output) {
  fs.writeFileSync(
    path.join(directory, output),
    names
      .sort()
      .map((name) => `${sha256(path.join(directory, name))}  ${name}\n`)
      .join(""),
  );
}

export function verifyChecksums(directory, manifest) {
  const entries = fs.readFileSync(path.join(directory, manifest), "utf8").trim().split("\n");
  return entries.map((line) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || match[2] === manifest || sha256(path.join(directory, match[2])) !== match[1]) {
      throw new Error(`Invalid or mismatched checksum in ${manifest}.`);
    }
    return match[2];
  });
}
