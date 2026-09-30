import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDraft,
  assertReleaseVersion,
  commitNotes,
  readVersion,
  isStableVersion,
  isVersionBump,
  releaseEvent,
  verifyChecksums,
  writeChecksums,
} from "./release-utils.mjs";

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

test("only exact stable version bump messages receive a commitlint exception", () => {
  for (const message of ["Bump version 1.1.0", "Bump version 1.1.0\n", "Bump version 1.1.0\r\n"]) {
    assert.equal(isVersionBump(message), true);
  }
  for (const message of [
    "Bump version v1.1.0",
    "Bump version 01.1.0",
    "Bump version 1.1",
    "Bump version 1.1.0-beta.1",
    "Bump version 1.1.0+build",
    "Bump version 1.1.0\n\nextra",
    "Bump version 1.1.0 ",
    "Bump version 1.1.0\n\n",
    "anything goes",
  ]) {
    assert.equal(isVersionBump(message), false, message);
  }
  assert.equal(isStableVersion("1.1.0\n"), false);
});

test("release versions advance numerically and reset subordinate components", () => {
  for (const version of ["1.0.3", "1.1.0", "2.0.0"]) {
    assertReleaseVersion(`Bump version ${version}`, version, "1.0.2");
  }
  assertReleaseVersion("Bump version 1.10.0", "1.10.0", "1.9.9");
  for (const version of ["1.0.2", "1.0.1", "0.9.9", "1.1.1", "2.1.0", "2.0.1"]) {
    assert.throws(
      () => assertReleaseVersion(`Bump version ${version}`, version, "1.0.2"),
      /increase/,
    );
  }
  assert.throws(() => assertReleaseVersion("feat: new behavior", "1.1.0", "1.0.2"), /exactly/);
  assert.throws(() => assertReleaseVersion("Bump version 1.1.0", "1.2.0", "1.0.2"), /exactly/);
});

test("commitlint accepts version bumps while keeping normal Conventional Commit rules", () => {
  const cli = fileURLToPath(new URL("../node_modules/@commitlint/cli/cli.js", import.meta.url));
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const [message, valid] of [
    ["Bump version 1.1.0", true],
    ["feat(personas): add instructions", true],
    ["ci(release): validate versions", true],
    ["Bump version v1.1.0", false],
    ["Bump version 01.1.0", false],
    ["arbitrary message", false],
  ]) {
    const result = spawnSync(process.execPath, [cli], {
      cwd: root,
      input: message,
      encoding: "utf8",
    });
    assert.equal(result.status === 0, valid, `${message}: ${result.stderr}${result.stdout}`);
  }
});

function workflowFixture(t, { linux = false, history = false } = {}) {
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
        if (args[1].endsWith('/')) { const error = new Error('Invalid API path'); error.stderr = 'HTTP 404'; throw error; }
        let result = {};
        if (args[1].includes('/releases/tags/')) result = state.release;
        if (args[1].includes('/releases?')) result = state.releases || [];
        if (args[1].includes('/git/ref/tags/')) result = state.tag ? { object: {} } : null;
        if (args[1].includes('/commits/')) result = { sha: state.tag };
        if (!result) { const error = new Error('not found'); error.stderr = 'HTTP 404'; throw error; }
        return JSON.stringify(result);
      }
      if (args[1] === 'create') {
        state.release = { draft: true, target_commitish: args[args.indexOf('--target') + 1], assets: [] };
        fs.writeFileSync(process.env.TEST_GH_STATE, JSON.stringify(state));
      }
      if (args[1] === 'upload' && state.failUpload) throw new Error('Simulated upload failure');
      return '';
    };
    syncBuiltinESMExports();
  `,
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "tag.gpgsign", "false");
  const setVersion = (version) => {
    for (const file of ["package.json", "apps/desktop/package.json", "src-tauri/tauri.conf.json"]) {
      fs.writeFileSync(path.join(root, file), JSON.stringify({ version }));
    }
    fs.writeFileSync(
      path.join(root, "Cargo.toml"),
      `[workspace.package]\nversion = "${version}"\n`,
    );
  };
  setVersion("1.0.2");
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
  const base = git("rev-parse", "HEAD");
  if (history) {
    git("tag", "-a", "v1.0.2", "-m", "previous release", "--", base);
    fs.writeFileSync(path.join(root, "change.md"), "New version\n");
    git("add", "change.md");
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
      "feat: keyboard translation",
    );
  }
  setVersion("1.0.3");
  git("add", ".");
  git("-c", "core.hooksPath=disabled-hooks", "commit", "--quiet", "-m", "Bump version 1.0.3");
  const commit = git("rev-parse", "HEAD");
  fs.mkdirSync(path.join(root, "dist/release/upload"), { recursive: true });
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "example/fork",
    GITHUB_SHA: commit,
    GITHUB_OUTPUT: path.join(root, "dist/output"),
    TEST_GH_STATE: path.join(root, "dist/state.json"),
    TEST_GH_LOG: path.join(root, "dist/gh.log"),
    TEST_BUILD_ARGS: path.join(root, "dist/build-args.json"),
    RELEASE_LINUX: String(linux),
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
    ...(linux ? [["x86_64-unknown-linux-gnu", "linux-x86_64", ".AppImage"]] : []),
  ]) {
    const names = [
      `ZyntaxAI_1.0.3_${platform}${extension}`,
      `BUILDINFO-${platform}.json`,
      "LICENSE",
      "NOTICE",
    ];
    fs.writeFileSync(path.join(out, names[0]), "installer fixture");
    if (platform.startsWith("linux")) {
      names.push("ZyntaxAI_1.0.3_linux-x86_64.deb");
      fs.writeFileSync(path.join(out, names.at(-1)), "deb fixture");
    }
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
  return { root, out, env, run, commit, base };
}

test("release workflow rejects a non-bump commit before accessing GitHub", (t) => {
  const { root, env, run } = workflowFixture(t);
  execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=disabled-hooks",
      "commit",
      "--amend",
      "--quiet",
      "-m",
      "feat: update application",
    ],
    { cwd: root },
  );
  env.GITHUB_SHA = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  for (const event of ["workflow_dispatch", "push"]) {
    env.GITHUB_EVENT_NAME = event;
    env.GITHUB_REF = "refs/tags/v1.0.3";
    const result = run("release-github.mjs", "validate");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release commit must be exactly/);
    assert.equal(fs.existsSync(env.TEST_GH_LOG), false);
  }
});

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
  assert.deepEqual(calls[0], ["api", "repos/example/fork"]);
  const create = calls.find((args) => args[1] === "create");
  assert.equal(create[create.indexOf("--repo") + 1], "example/fork");
  assert.equal(create[create.indexOf("--target") + 1], commit);
  assert.ok(create.includes("--draft"));
  assert.ok(calls.some((args) => args[1] === "upload"));
  assert.ok(!calls.some((args) => args.includes("--draft=false")));
  assert.match(fs.readFileSync(path.join(out, "COMMIT_CHANGES.md"), "utf8"), /First release/);
});

test("version tags must match metadata; manual runs remain drafts", () => {
  assert.equal(releaseEvent("push", "refs/tags/v1.0.3", "v1.0.3"), true);
  assert.equal(releaseEvent("workflow_dispatch", "refs/tags/v1.0.3", "v1.0.3"), false);
  for (const ref of ["refs/heads/main", "refs/tags/v1.0.2", "refs/tags/v1.0.3-beta"]) {
    assert.throws(() => releaseEvent("push", ref, "v1.0.3"), /matching/);
  }
});

test("commit notes preserve subjects as Markdown text and link individual commits", () => {
  const changes = commitNotes(
    "owner/fork",
    [{ hash: "a".repeat(40), subject: "fix: <script> [link](url) `code`" }],
    "v1.0.2",
    "v1.0.3",
  );
  assert.ok(changes.includes("\\<script\\>"));
  assert.ok(changes.includes("https://github.com/owner/fork/commit/"));
  assert.ok(changes.includes("/compare/v1.0.2...v1.0.3"));
});

test("tag release publishes all platform assets only after upload and adds commits since the previous published release", (t) => {
  const { root, out, env, run, commit } = workflowFixture(t, { linux: true, history: true });
  env.GITHUB_EVENT_NAME = "push";
  env.GITHUB_REF = "refs/tags/v1.0.3";
  fs.writeFileSync(
    env.TEST_GH_STATE,
    JSON.stringify({
      release: null,
      tag: commit,
      releases: [
        { draft: false, prerelease: false, tag_name: "v1.0.2" },
        { draft: true, tag_name: "v1.0.1" },
      ],
    }),
  );
  const result = run("release-github.mjs", "draft");
  assert.equal(result.status, 0, result.stderr);
  const changes = fs.readFileSync(path.join(out, "COMMIT_CHANGES.md"), "utf8");
  assert.match(changes, /feat: keyboard translation/);
  assert.doesNotMatch(changes, /test: fixture/);
  assert.match(changes, /Changes since v1.0.2/);
  assert.ok(fs.readFileSync(path.join(root, "dist/release/notes.md"), "utf8").includes(changes));
  const calls = fs.readFileSync(env.TEST_GH_LOG, "utf8").trim().split("\n").map(JSON.parse);
  const upload = calls.findIndex((args) => args[1] === "upload");
  const publish = calls.findIndex((args) => args.includes("--draft=false"));
  assert.ok(upload >= 0 && publish > upload);
  assert.ok(calls[publish].includes("--verify-tag"));
  assert.ok(calls[upload].some((arg) => arg.endsWith("linux-x86_64.deb")));
});

test("tag release cannot publish after an incomplete upload", (t) => {
  const { env, run, commit } = workflowFixture(t);
  env.GITHUB_EVENT_NAME = "push";
  env.GITHUB_REF = "refs/tags/v1.0.3";
  fs.writeFileSync(
    env.TEST_GH_STATE,
    JSON.stringify({ release: null, tag: commit, failUpload: true }),
  );
  const result = run("release-github.mjs", "draft");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Simulated upload failure/);
  assert.doesNotMatch(fs.readFileSync(env.TEST_GH_LOG, "utf8"), /--draft=false/);
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
