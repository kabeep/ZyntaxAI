import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  git,
  isBinding,
  isFrontendCode,
  isScript,
  revisionChanges,
  rustPackage,
  scopesFor,
  stagedChanges,
  stagedScopes,
} from "./check-scopes.mjs";
import { frontendTests, frontendTypes, lintFiles, run, syntaxFiles } from "./check-tools.mjs";

const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const [mode = "worktree", ...options] = process.argv.slice(2);
const wantsTests = options.includes("--tests");

function eventScope() {
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : null;
  if (process.env.GITHUB_EVENT_NAME === "push")
    return revisionChanges(root, event.before, event.after);
  if (process.env.GITHUB_EVENT_NAME === "pull_request")
    return revisionChanges(root, event.pull_request.base.sha, event.pull_request.head.sha, {
      mergeBase: true,
    });
  const scope = scopesFor([], { all: true, reason: "Explicit full static validation" });
  if (!wantsTests && event?.inputs?.tests !== true && event?.inputs?.tests !== "true") {
    scope.frontendTests = scope.toolingTests = scope.rustTests = [];
  }
  return scope;
}

function selection() {
  if (process.env.GITHUB_ACTIONS === "true") return eventScope();
  const changes = stagedChanges(root);
  const scope = stagedScopes(root, changes);
  if (mode === "related") {
    // Explicit worktree command; this is not a pristine index snapshot.
    if (!changes.length) throw new Error("Stage paths first so related tests have a scope");
    if (scope.frontendTests !== "all") scope.frontendTests = scope.paths.filter(isFrontendCode);
    scope.rustTests = [...new Set(scope.paths.map(rustPackage).filter(Boolean))];
    if (scope.rust && scope.rustTests.length === 0) scope.rustTests = "all";
    if (scope.tooling) scope.toolingTests = "all";
  }
  return scope;
}

const scope = selection();
const tracked = git(root, ["ls-files", "-z"])
  .split("\0")
  .filter((path) => path && existsSync(resolve(root, path)));

try {
  if (mode === "scope") {
    for (const name of ["frontend", "rust", "tooling", "workflow", "contract"]) {
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${scope[name]}\n`);
    }
    console.log(JSON.stringify(scope, null, 2));
  } else {
    if (!["frontend", "rust", "tooling", "worktree", "related"].includes(mode))
      throw new Error(`Unknown check profile: ${mode}`);
    console.log(`Validation scope: ${JSON.stringify(scope)}`);
    const enabled = (name) =>
      mode === name || ((mode === "worktree" || mode === "related") && scope[name]);
    if (enabled("frontend")) {
      lintFiles(
        root,
        tracked.filter((path) => isFrontendCode(path) && !isBinding(path)),
      );
      frontendTypes(root);
      frontendTests(root, wantsTests ? "all" : scope.frontendTests, {
        related: mode === "related" && !wantsTests,
      });
    }
    if (enabled("tooling")) {
      lintFiles(
        root,
        tracked.filter((path) => path.startsWith("scripts/") && isScript(path)),
      );
      syntaxFiles(root, tracked.filter(isScript));
      const tests =
        wantsTests || scope.toolingTests === "all"
          ? tracked.filter((path) => path.startsWith("scripts/") && path.endsWith(".test.mjs"))
          : scope.toolingTests.filter((path) => existsSync(resolve(root, path)));
      if (tests.length) run(root, process.execPath, ["--test", ...tests]);
    }
    if (enabled("rust")) {
      run(root, "cargo", ["fmt", "--all", "--", "--check"]);
      run(root, "cargo", [
        "clippy",
        "--workspace",
        "--all-targets",
        "--locked",
        "--",
        "-D",
        "warnings",
      ]);
      if (wantsTests || scope.rustTests === "all")
        run(root, process.execPath, ["scripts/test-rust.mjs"]);
      else
        for (const pkg of scope.rustTests)
          run(root, process.execPath, ["scripts/test-rust.mjs", "--package", pkg]);
      if (scope.contract) run(root, process.execPath, ["scripts/check-bindings.mjs", "--verify"]);
    }
    if ((mode === "worktree" || mode === "related") && scope.workflow)
      console.log("Workflow syntax is checked by actionlint in CI.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
