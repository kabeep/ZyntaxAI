import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDraft, readVersion, verifyChecksums, writeChecksums } from "./release-utils.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zyntax-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["package.json", "apps/desktop/package.json", "src-tauri/tauri.conf.json"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify({ version: "1.0.3" }));
  }
  fs.writeFileSync(path.join(root, "Cargo.toml"), '[workspace.package]\nversion = "1.0.3"\n');
  return root;
}

test("release metadata rejects divergent or unsupported versions", (t) => {
  const root = fixture(t);
  assert.equal(readVersion(root), "1.0.3");
  fs.writeFileSync(path.join(root, "package.json"), '{"version":"1.0.2"}');
  assert.throws(() => readVersion(root), /matching/);
  fs.writeFileSync(path.join(root, "package.json"), '{"version":"1.0.3-beta"}');
  assert.throws(() => readVersion(root), /matching/);
});

function workflowFixture(t) {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "scripts"));
  for (const name of ["release-utils.mjs", "release-github.mjs", "release.mjs"]) {
    fs.copyFileSync(
      fileURLToPath(new URL(name, import.meta.url)),
      path.join(root, "scripts", name),
    );
  }
  fs.writeFileSync(path.join(root, ".gitignore"), "dist/\n");
  fs.writeFileSync(path.join(root, "LICENSE"), "GPL fixture\n");
  fs.writeFileSync(path.join(root, "NOTICE"), "Original author attribution\n");
  fs.writeFileSync(
    path.join(root, "mock.mjs"),
    `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import fs from 'node:fs';
    import path from 'node:path';
    const original = cp.execFileSync;
    cp.execFileSync = (command, args, options) => {
      if (command === process.execPath && args[0].endsWith('tauri.js')) {
        fs.writeFileSync(process.env.TEST_BUILD_ARGS, JSON.stringify(args));
        const target = args[args.indexOf('--target') + 1];
        const mac = target.includes('darwin');
        const dir = path.join(process.env.CARGO_TARGET_DIR, target, 'release/bundle', mac ? 'dmg' : 'nsis');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, mac ? 'ZyntaxAI_1.0.3.dmg' : 'ZyntaxAI_1.0.3_x64-setup.exe'), 'fixture installer');
        return '';
      }
      if (command !== 'gh') return original(command, args, options);
      fs.appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(args) + '\\n');
      const state = JSON.parse(fs.readFileSync(process.env.TEST_GH_STATE, 'utf8'));
      if (args[0] === 'api') {
        let result = {};
        if (args[1].includes('/releases/tags/')) result = state.release;
        if (args[1].includes('/git/ref/tags/')) result = state.tag ? { object: {} } : null;
        if (args[1].includes('/commits/')) result = { sha: state.tag };
        if (!result) { const error = new Error('not found'); error.stderr = 'HTTP 404'; throw error; }
        return JSON.stringify(result);
      }
      if (args[1] === 'create') {
        state.release = { draft: true, target_commitish: args[args.indexOf('--target') + 1], assets: [] };
        fs.writeFileSync(process.env.TEST_GH_STATE, JSON.stringify(state));
      }
      return '';
    };
    syncBuiltinESMExports();
  `,
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git(
    "-c",
    "user.name=Release Test",
    "-c",
    "user.email=release-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=disabled-hooks",
    "commit",
    "--quiet",
    "-m",
    "test: fixture",
  );
  const commit = git("rev-parse", "HEAD");
  fs.mkdirSync(path.join(root, "dist/release/upload"), { recursive: true });
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "example/fork",
    GITHUB_SHA: commit,
    GITHUB_OUTPUT: path.join(root, "dist/output"),
    TEST_GH_STATE: path.join(root, "dist/state.json"),
    TEST_GH_LOG: path.join(root, "dist/gh.log"),
    TEST_BUILD_ARGS: path.join(root, "dist/build-args.json"),
    RELEASE_LINUX: "false",
    RELEASE_NOTES: 'Quotes " and $(echo not-executed) `stay literal`',
    CARGO_TARGET_DIR: path.join(root, "dist/cargo-cache"),
  };
  fs.writeFileSync(env.TEST_GH_STATE, JSON.stringify({ release: null, tag: null }));
  const run = (script, ...args) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.join(root, "mock.mjs")).href,
        path.join(root, "scripts", script),
        ...args,
      ],
      { cwd: root, env, encoding: "utf8" },
    );
  const out = path.join(root, "dist/release/upload");
  for (const [target, platform, extension] of [
    ["x86_64-pc-windows-msvc", "windows-x86_64", "-setup.exe"],
    ["aarch64-apple-darwin", "darwin-aarch64", ".dmg"],
    ["x86_64-apple-darwin", "darwin-x86_64", ".dmg"],
  ]) {
    const names = [
      `ZyntaxAI_1.0.3_${platform}${extension}`,
      `BUILDINFO-${platform}.json`,
      "LICENSE",
      "NOTICE",
    ];
    fs.writeFileSync(path.join(out, names[0]), "installer fixture");
    fs.writeFileSync(
      path.join(out, names[1]),
      JSON.stringify({
        version: "1.0.3",
        commit,
        target,
        platform,
        updaterArtifacts: false,
        signing: platform.startsWith("darwin") ? "ad-hoc" : "none",
      }),
    );
    for (const name of ["LICENSE", "NOTICE"])
      fs.copyFileSync(path.join(root, name), path.join(out, name));
    writeChecksums(out, names, `SHA256SUMS-${platform}.txt`);
  }
  return { root, out, env, run, commit };
}

test("draft pipeline uploads exact source and notices to the fork with literal release notes", (t) => {
  const { root, out, env, run, commit } = workflowFixture(t);
  const validation = run("release-github.mjs", "validate");
  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "version=1.0.3\ntag=v1.0.3\n");
  const result = run("release-github.mjs", "draft");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(out, "ZyntaxAI_1.0.3_source.zip")));
  assert.ok(fs.existsSync(path.join(out, "ZyntaxAI_1.0.3_source.tar.gz")));
  assert.match(fs.readFileSync(path.join(out, "SOURCE.md"), "utf8"), new RegExp(commit));
  assert.ok(
    fs.readFileSync(path.join(root, "dist/release/notes.md"), "utf8").includes(env.RELEASE_NOTES),
  );
  verifyChecksums(out, "SHA256SUMS.txt");
  const calls = fs.readFileSync(env.TEST_GH_LOG, "utf8").trim().split("\n").map(JSON.parse);
  const create = calls.find((args) => args[1] === "create");
  assert.equal(create[create.indexOf("--repo") + 1], "example/fork");
  assert.equal(create[create.indexOf("--target") + 1], commit);
  assert.ok(create.includes("--draft"));
  assert.ok(calls.some((args) => args[1] === "upload"));
});

test("draft pipeline stops before mutations on published releases or mismatched tags", (t) => {
  const { env, run, commit } = workflowFixture(t);
  for (const state of [
    { release: { draft: false }, tag: commit },
    { release: null, tag: "wrong-commit" },
  ]) {
    fs.writeFileSync(env.TEST_GH_STATE, JSON.stringify(state));
    const result = run("release-github.mjs", "draft");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /published release|different source commit/);
  }
  assert.doesNotMatch(fs.readFileSync(env.TEST_GH_LOG, "utf8"), /"create"|"edit"|"upload"/);
});

test("draft pipeline rejects tampered platform artifacts before mutations", (t) => {
  const { out, env, run } = workflowFixture(t);
  fs.writeFileSync(path.join(out, "ZyntaxAI_1.0.3_windows-x86_64-setup.exe"), "tampered");
  const result = run("release-github.mjs", "draft");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mismatched checksum/);
  assert.doesNotMatch(fs.readFileSync(env.TEST_GH_LOG, "utf8"), /"create"|"edit"|"upload"/);
});

test("draft pipeline rejects a missing platform or unrelated source metadata", (t) => {
  const { out, env, run } = workflowFixture(t);
  const name = "BUILDINFO-windows-x86_64.json";
  const info = JSON.parse(fs.readFileSync(path.join(out, name), "utf8"));
  info.commit = "different-source";
  fs.writeFileSync(path.join(out, name), JSON.stringify(info));
  writeChecksums(
    out,
    [name, "ZyntaxAI_1.0.3_windows-x86_64-setup.exe", "LICENSE", "NOTICE"],
    "SHA256SUMS-windows-x86_64.txt",
  );
  assert.match(run("release-github.mjs", "draft").stderr, /source metadata differs/);
  info.commit = env.GITHUB_SHA;
  fs.writeFileSync(path.join(out, name), JSON.stringify(info));
  writeChecksums(
    out,
    [name, "ZyntaxAI_1.0.3_windows-x86_64-setup.exe", "LICENSE", "NOTICE"],
    "SHA256SUMS-windows-x86_64.txt",
  );
  fs.unlinkSync(path.join(out, "SHA256SUMS-darwin-aarch64.txt"));
  const result = run("release-github.mjs", "draft");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(fs.readFileSync(env.TEST_GH_LOG, "utf8"), /"create"|"edit"|"upload"/);
});

test("a draft bound to the same commit can be retried without publishing", (t) => {
  const { env, run, commit } = workflowFixture(t);
  fs.writeFileSync(
    env.TEST_GH_STATE,
    JSON.stringify({ release: { draft: true, target_commitish: commit, assets: [] }, tag: null }),
  );
  const result = run("release-github.mjs", "draft");
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(env.TEST_GH_LOG, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls.some((args) => args[1] === "edit"));
  assert.ok(calls.some((args) => args[1] === "upload"));
  assert.ok(!calls.some((args) => args.includes("--draft=false") || args[1] === "create"));
});

test("macOS packaging uses certificate-free ad-hoc signing rather than disabling code signing", (t) => {
  const { env, run } = workflowFixture(t);
  const result = run("release.mjs", "--target", "aarch64-apple-darwin");
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(fs.readFileSync(env.TEST_BUILD_ARGS, "utf8"));
  assert.equal(args.includes("--no-sign"), false);
  assert.deepEqual(JSON.parse(args[args.indexOf("--config") + 1]).bundle, {
    createUpdaterArtifacts: false,
    macOS: { signingIdentity: "-" },
  });
});

test("local packaging honours Cargo cache, cleans stale bundles and omits signing/updater artifacts", (t) => {
  const { root, env, run, commit } = workflowFixture(t);
  const stale = path.join(
    env.CARGO_TARGET_DIR,
    "x86_64-pc-windows-msvc/release/bundle/nsis/old-setup.exe",
  );
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "stale");
  const result = run("release.mjs", "--target", "x86_64-pc-windows-msvc");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(stale), false);
  const out = path.join(root, "dist/release/1.0.3/windows-x86_64");
  assert.ok(fs.existsSync(path.join(out, "ZyntaxAI_1.0.3_windows-x86_64-setup.exe")));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(out, "BUILDINFO-windows-x86_64.json"))).commit,
    commit,
  );
  const args = JSON.parse(fs.readFileSync(env.TEST_BUILD_ARGS, "utf8"));
  assert.deepEqual(args.slice(-2), ["--", "--locked"]);
  assert.ok(args.includes("--no-sign"));
  assert.equal(JSON.parse(args[args.indexOf("--config") + 1]).bundle.createUpdaterArtifacts, false);
  assert.equal(fs.existsSync(env.TEST_GH_LOG), false);
});

test("only drafts with matching source tags can be retried", () => {
  assert.doesNotThrow(() => assertDraft(null, "abc", null));
  assert.doesNotThrow(() => assertDraft({ isDraft: true }, "abc", "abc"));
  assert.throws(() => assertDraft({ isDraft: false }, "abc", "abc"), /published/);
  assert.throws(() => assertDraft({ isDraft: true }, "abc", "def"), /different/);
});

test("artifact checksums detect tampering, missing files and path traversal", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "installer.exe"), "installer");
  writeChecksums(root, ["installer.exe"], "SHA256SUMS.txt");
  assert.deepEqual(verifyChecksums(root, "SHA256SUMS.txt"), ["installer.exe"]);
  fs.writeFileSync(path.join(root, "installer.exe"), "tampered");
  assert.throws(() => verifyChecksums(root, "SHA256SUMS.txt"), /mismatched/);
  fs.unlinkSync(path.join(root, "installer.exe"));
  assert.throws(() => verifyChecksums(root, "SHA256SUMS.txt"));
  fs.writeFileSync(path.join(root, "SHA256SUMS.txt"), `${"0".repeat(64)}  ../secret\n`);
  assert.throws(() => verifyChecksums(root, "SHA256SUMS.txt"), /Invalid/);
});
