import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compareBindings, sourceFingerprint, verifyBindings } from "./bindings.mjs";
import { git, parseChanges, revisionChanges, scopesFor, stagedChanges } from "./check-scopes.mjs";
import { checkStaged, fastFiles, needsTypes } from "./check-staged.mjs";
import { batches } from "./check-tools.mjs";

const change = (path, status = "M", previous = path) => ({ status, previous, current: path });

function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), "zyntax-checks-"));
  const root = resolve(base, "repo with spaces");
  mkdirSync(root);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Checks test"]);
  git(root, ["config", "user.email", "checks@example.invalid"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.hooksPath", ".git/no-hooks"]);
  const write = (path, content) => {
    mkdirSync(resolve(root, path, ".."), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const commit = () => {
    git(root, ["add", "."]);
    git(root, ["commit", "-qm", "test: fixture"]);
    return git(root, ["rev-parse", "HEAD"]).trim();
  };
  write("README.md", "fixture\n");
  write(".gitignore", "target/\nnode_modules/\n");
  commit();
  t.after(() => {
    if (!base.startsWith(`${resolve(tmpdir())}${sep}zyntax-checks-`))
      throw new Error("Unsafe fixture cleanup");
    rmSync(base, { recursive: true, force: true });
  });
  return { root, write, commit };
}

test("NUL changes preserve spaces, newlines and both rename paths", () => {
  assert.deepEqual(parseChanges("M\0a space.ts\0R100\0old\nfile.rs\0new.ts\0D\0deleted.tsx\0"), [
    change("a space.ts"),
    change("new.ts", "R100", "old\nfile.rs"),
    change("deleted.tsx", "D"),
  ]);
  assert.throws(() => parseChanges("R100\0old\0"));
});

test("docs and metadata do not schedule source checks", () => {
  const scope = scopesFor([change("README.md"), change("docs/RELEASING.md"), change(".gitignore")]);
  for (const name of ["frontend", "rust", "tooling", "workflow", "contract"])
    assert.equal(scope[name], false);
});

test("frontend display changes schedule lint/types only; deleted files keep scope", () => {
  for (const status of ["M", "D"]) {
    const scope = scopesFor([change("apps/desktop/src/App.tsx", status)]);
    assert.equal(scope.frontend, true);
    assert.equal(scope.rust, false);
    assert.deepEqual(scope.frontendTests, []);
  }
  assert.equal(scopesFor([change("apps/desktop/src/theme.css")]).frontend, false);
});

test("test files and helpers select tests, ordinary features do not force all tests", () => {
  const front = scopesFor([change("apps/desktop/src/App.test.tsx")]);
  assert.deepEqual(front.frontendTests, ["apps/desktop/src/App.test.tsx"]);
  assert.equal(scopesFor([change("apps/desktop/vite.config.ts")]).frontendTests, "all");
  assert.deepEqual(scopesFor([change("crates/zyntax-core/tests/prompt.rs")]).rustTests, [
    "zyntax-core",
  ]);
  assert.deepEqual(scopesFor([change("src-tauri/tests/commands.rs")]).rustTests, ["zyntax"]);
  assert.deepEqual(scopesFor([change("scripts/release-utils.test.mjs")]).toolingTests, [
    "scripts/release-utils.test.mjs",
  ]);
});

test("contracts and dependencies expand the corresponding ecosystem", () => {
  const exported = "crates/zyntax-core/src/persona.rs";
  const scope = scopesFor([change(exported)], { exportedPaths: [exported] });
  assert.equal(scope.contract && scope.rust && scope.frontend, true);
  assert.equal(scopesFor([change("crates/zyntax-core/src/prompt.rs")]).frontend, false);
  assert.equal(scopesFor([change("Cargo.lock")]).contract, true);
  const node = scopesFor([change("pnpm-lock.yaml")]);
  assert.equal(node.frontend && node.tooling, true);
  assert.equal(node.rust, false);
  assert.equal(node.frontendTests, "all");
});

test("workflow-only and unknown paths have conservative distinct scopes", () => {
  const workflow = scopesFor([change(".github/workflows/release.yml")]);
  assert.equal(workflow.workflow, true);
  assert.equal(workflow.rust || workflow.frontend || workflow.tooling, false);
  const unknown = scopesFor([change("new-backend/custom.code")]);
  assert.equal(unknown.frontend && unknown.rust && unknown.tooling, true);
  assert.deepEqual(unknown.rustTests, []);
  assert.match(unknown.reason, /Unclassified/);
});

test("rename crosses language scopes; deletion is never linted as an existing file", () => {
  const changes = [
    change("apps/desktop/src/new.ts", "R100", "crates/zyntax-core/src/old.rs"),
    change("apps/desktop/src/gone.ts", "D"),
  ];
  const scope = scopesFor(changes);
  assert.equal(scope.frontend && scope.rust, true);
  assert.deepEqual(fastFiles(changes).lint, ["apps/desktop/src/new.ts"]);
  assert.deepEqual(
    fastFiles([change("apps/desktop/src/lib/bindings/serde_json/JsonValue.ts")]).lint,
    [],
  );
});

test("pre-commit Cargo manifests do not trigger frontend types; TS deletion does", () => {
  assert.equal(needsTypes([change("Cargo.toml")]), false);
  assert.equal(needsTypes([change("scripts/tool.mjs")]), false);
  assert.equal(needsTypes([change("apps/desktop/src/gone.ts", "D")]), true);
  assert.equal(needsTypes([change("pnpm-lock.yaml")]), true);
});

test("CI event CLI writes scoped outputs; manual all-tests is explicit", (t) => {
  const { root, write, commit } = fixture(t);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  write("apps/desktop/src/display.tsx", "export const display = 1;\n");
  const head = commit();
  const eventPath = resolve(root, "..", "event.json");
  const outputPath = resolve(root, "..", "outputs.txt");
  const script = fileURLToPath(new URL("./check-changes.mjs", import.meta.url));
  function invoke(name, event) {
    writeFileSync(eventPath, JSON.stringify(event));
    writeFileSync(outputPath, "");
    return JSON.parse(
      execFileSync(process.execPath, [script, "scope"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: name,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_OUTPUT: outputPath,
        },
      }),
    );
  }
  const push = invoke("push", { before: base, after: head });
  assert.equal(push.frontend, true);
  assert.equal(push.rust, false);
  assert.match(readFileSync(outputPath, "utf8"), /frontend=true\nrust=false/);
  assert.deepEqual(push.frontendTests, []);
  const pr = invoke("pull_request", { pull_request: { base: { sha: base }, head: { sha: head } } });
  assert.equal(pr.frontend, true);
  assert.deepEqual(invoke("workflow_dispatch", { inputs: { tests: false } }).rustTests, []);
  assert.equal(invoke("workflow_dispatch", { inputs: { tests: true } }).rustTests, "all");
});

test("push diffs handle divergent history; PR scopes use the merge base", (t) => {
  const { root, write, commit } = fixture(t);
  const common = git(root, ["rev-parse", "HEAD"]).trim();
  write("scripts/other.mjs", "export const other = 1;\n");
  const branch = commit();
  git(root, ["checkout", "-q", "--detach", common]);
  write("apps/desktop/src/feature.ts", "export const feature = 1;\n");
  const head = commit();
  const push = revisionChanges(root, branch, head);
  assert.equal(push.tooling && push.frontend, true);
  const pr = revisionChanges(root, branch, head, { mergeBase: true });
  assert.equal(pr.frontend, true);
  assert.equal(pr.tooling, false);
  const missing = revisionChanges(root, "0".repeat(40), head);
  assert.equal(missing.frontend && missing.rust && missing.tooling && missing.workflow, true);
  assert.equal(missing.rustTests, "all");
});

test("contract detection checks both sides including removed exports", (t) => {
  const { root, write, commit } = fixture(t);
  write("crates/zyntax-core/src/persona.rs", "#[ts(export)]\nstruct Persona;\n");
  const base = commit();
  write("crates/zyntax-core/src/persona.rs", "struct Persona;\n");
  const head = commit();
  assert.equal(revisionChanges(root, base, head).contract, true);
});

test("binding comparisons ignore CRLF only, and detect added/deleted/changed exports", (t) => {
  assert.deepEqual(compareBindings({ a: "export A;\r\n" }, { a: "export A;\n" }), []);
  assert.deepEqual(compareBindings({ a: "old", gone: "old" }, { a: "new", added: "new" }), [
    "a",
    "added",
    "gone",
  ]);
  const { root, write, commit } = fixture(t);
  write("apps/desktop/src/lib/bindings/A.ts", "export type A = string;\r\n");
  commit();
  write("target/validation-bindings/A.ts", "export type A = string;\n");
  assert.throws(() => verifyBindings(root), /No complete exports/);
  write(
    "target/validation-bindings/.complete",
    JSON.stringify({ source: sourceFingerprint(root) }),
  );
  verifyBindings(root);
  write("target/validation-bindings/A.ts", "export type A = number;\n");
  assert.throws(() => verifyBindings(root), /Bindings differ/);
  write("Cargo.toml", "changed source\n");
  git(root, ["add", "Cargo.toml"]);
  assert.throws(() => verifyBindings(root), /Rust sources changed/);
});

test("argument batches keep paths intact within platform limits", () => {
  const paths = Array.from(
    { length: 60 },
    (_, i) => `directory with spaces/${i}/${"x".repeat(180)}.ts`,
  );
  const groups = batches(paths, 1000);
  assert.deepEqual(groups.flat(), paths);
  assert.ok(groups.length > 1);
  for (const group of groups)
    assert.ok(group.reduce((length, path) => length + path.length + 3, 0) <= 1000);
});

test("docs-only and empty staging run no tools and permit unrelated WIP", async (t) => {
  const { root, write } = fixture(t);
  write("apps/desktop/src/untracked.ts", "invalid source\n");
  assert.equal(await checkStaged(root), true);
  write("README.md", "new docs\n");
  git(root, ["add", "README.md"]);
  const before = git(root, ["write-tree"]);
  assert.equal(await checkStaged(root), true);
  assert.equal(git(root, ["write-tree"]), before);
  assert.equal(
    readFileSync(resolve(root, "apps/desktop/src/untracked.ts"), "utf8"),
    "invalid source\n",
  );
});

for (const outcome of ["success", "failure", "interrupt", "mutation"]) {
  test(`lint-staged restores partial staging and unrelated WIP after ${outcome}`, async (t) => {
    const { root, write, commit } = fixture(t);
    const path = "scripts/a space.mjs";
    write(path, "export const value = 1;\n");
    write("tracked.txt", "original\n");
    commit();
    write(path, "export const value = 2;\n");
    git(root, ["add", path]);
    write(path, "export const value = 2;\n// unfinished WIP\n");
    write("tracked.txt", "unrelated WIP\n");
    write("untracked.txt", "keep this\n");
    const beforeTree = git(root, ["write-tree"]);
    const beforeStatus = git(root, ["status", "--porcelain=v1", "-z"]);
    const beforeDiff = git(root, ["diff", "--binary"]);
    const listeners = process.listeners("SIGINT");
    t.after(() => {
      for (const listener of process.listeners("SIGINT"))
        if (!listeners.includes(listener)) process.removeListener("SIGINT", listener);
    });
    let calls = 0;
    let observedStagedView = false;
    const passed = await checkStaged(root, {
      quiet: true,
      task: async (files) => {
        calls++;
        assert.deepEqual(files.syntax, [path]);
        assert.equal(readFileSync(resolve(root, path), "utf8"), "export const value = 2;\n");
        assert.equal(readFileSync(resolve(root, "tracked.txt"), "utf8"), "original\n");
        assert.equal(existsSync(resolve(root, "untracked.txt")), false);
        observedStagedView = true;
        if (outcome === "interrupt") {
          process.emit("SIGINT");
          throw new Error("Interrupted check");
        }
        if (outcome === "failure") throw new Error("Expected failing check");
        if (outcome === "mutation") write(path, "accidental modification\n");
      },
    });
    assert.equal(calls, 1);
    assert.equal(observedStagedView, true);
    assert.equal(passed, outcome === "success");
    assert.equal(git(root, ["write-tree"]), beforeTree);
    assert.equal(git(root, ["status", "--porcelain=v1", "-z"]), beforeStatus);
    assert.equal(git(root, ["diff", "--binary"]), beforeDiff);
    assert.equal(readFileSync(resolve(root, "untracked.txt"), "utf8"), "keep this\n");
    assert.equal(git(root, ["stash", "list"]), "");
  });
}

test("staged deletion and rename are parsed in a real Git index", (t) => {
  const { root, write, commit } = fixture(t);
  write("old name.ts", "export const value = 1;\n");
  write("gone.ts", "export const gone = 1;\n");
  commit();
  renameSync(resolve(root, "old name.ts"), resolve(root, "new name.ts"));
  rmSync(resolve(root, "gone.ts"));
  git(root, ["add", "-A"]);
  const changes = stagedChanges(root);
  assert.ok(changes.some(({ status, current }) => status === "D" && current === "gone.ts"));
  assert.ok(
    changes.some(
      ({ status, previous, current }) =>
        status.startsWith("R") && previous === "old name.ts" && current === "new name.ts",
    ),
  );
});

test("Node syntax errors are reported rather than treated as successful checks", (t) => {
  const { root, write } = fixture(t);
  write("bad script.mjs", "export const = ;\n");
  assert.throws(() =>
    execFileSync(process.execPath, ["--check", "bad script.mjs"], { cwd: root, stdio: "pipe" }),
  );
});
