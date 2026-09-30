import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
  if (!/^\d+\.\d+\.\d+$/.test(versions[0]) || versions.some((version) => version !== versions[0])) {
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
