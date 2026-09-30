#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readVersion, targets, writeChecksums } from "./release-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const defaultTarget = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
}[`${process.platform}-${process.arch}`];
const target =
  args.length === 0
    ? defaultTarget
    : args[0] === "--target" && args.length === 2
      ? args[1]
      : undefined;
if (!targets[target]) throw new Error("Usage: pnpm release [--target <supported Rust triple>]");
const { platform, bundles, extension } = targets[target];
const macOS = platform.startsWith("darwin");
const version = readVersion(root);
const git = (...parameters) =>
  execFileSync("git", parameters, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain"))
  throw new Error("Release builds require a clean, committed working tree.");
const commit = git("rev-parse", "HEAD");
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)
  throw new Error("Build checkout differs from the workflow commit.");

const targetDir = path.resolve(root, process.env.CARGO_TARGET_DIR || "target");
const bundleDir = path.join(targetDir, target, "release", "bundle");
if (path.relative(targetDir, bundleDir) !== path.join(target, "release", "bundle")) {
  throw new Error("Bundle cleanup escaped the configured Cargo target directory.");
}
// Remove only the known bundle directory so cached installers cannot enter a new release.
fs.rmSync(bundleDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "build",
    "--ci",
    ...(macOS ? [] : ["--no-sign"]),
    "--target",
    target,
    "--bundles",
    bundles,
    "--config",
    JSON.stringify({
      bundle: {
        createUpdaterArtifacts: false,
        ...(macOS ? { macOS: { signingIdentity: "-" } } : {}),
      },
    }),
    "--",
    "--locked",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(macOS ? { APPLE_SIGNING_IDENTITY: "-" } : {}),
      ...(process.platform === "linux" ? { NO_STRIP: "true" } : {}),
    },
  },
);

const installers = fs
  .readdirSync(bundleDir, { recursive: true })
  .filter((file) =>
    bundles
      .split(",")
      .some((bundle) =>
        file.endsWith(
          { nsis: "-setup.exe", dmg: ".dmg", deb: ".deb", appimage: ".AppImage" }[bundle],
        ),
      ),
  )
  .map((file) => path.join(bundleDir, file));
if (
  !installers.some((file) => file.endsWith(extension)) ||
  (bundles.includes("deb") && !installers.some((file) => file.endsWith(".deb")))
) {
  throw new Error(`Missing expected installers for ${platform}.`);
}
const out = path.join(root, "dist/release", version, platform);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of installers) {
  const name = `ZyntaxAI_${version}_${platform}${file.endsWith("-setup.exe") ? "-setup.exe" : path.extname(file)}`;
  if (fs.existsSync(path.join(out, name))) throw new Error(`Duplicate installer: ${name}`);
  fs.copyFileSync(file, path.join(out, name));
}
for (const file of ["LICENSE", "NOTICE"]) {
  const canonical = execFileSync("git", ["show", `${commit}:${file}`], { cwd: root });
  fs.writeFileSync(path.join(out, file), canonical);
}
fs.writeFileSync(
  path.join(out, `BUILDINFO-${platform}.json`),
  `${JSON.stringify({ version, commit, target, platform, updaterArtifacts: false, signing: macOS ? "ad-hoc" : "none" }, null, 2)}\n`,
);
writeChecksums(out, fs.readdirSync(out), `SHA256SUMS-${platform}.txt`);
console.log(`Installers and notices ready in ${out}. No release was uploaded.`);
