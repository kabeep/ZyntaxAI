import { execFileSync } from "node:child_process";

export function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

// --name-status -z has separate status/path fields; renames contain BOTH paths.
export function parseChanges(raw) {
  const fields = raw.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const changes = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++];
    const previous = fields[i++];
    const renamed = /^[RC]/.test(status);
    const current = renamed ? fields[i++] : previous;
    if (!status || !previous || !current) throw new Error("Incomplete Git change record");
    changes.push({ status, previous, current });
  }
  return changes;
}

export function stagedChanges(root) {
  return parseChanges(git(root, ["diff", "--cached", "--name-status", "-z", "--find-renames"]));
}

function hasExports(root, references, path) {
  if (!isRust(path)) return false;
  return references.some((reference) => {
    try {
      return /#\[\s*ts\s*\(\s*export/.test(git(root, ["show", `${reference}:${path}`]));
    } catch {
      return false;
    } // A renamed/added/deleted file may exist on only one side.
  });
}

export function stagedScopes(root, changes = stagedChanges(root)) {
  const paths = changes.flatMap(({ previous, current }) => [previous, current]);
  return scopesFor(changes, {
    exportedPaths: paths.filter((path) => hasExports(root, ["HEAD", ""], path)),
  });
}

export const isBinding = (path) => path.startsWith("apps/desktop/src/lib/bindings/");
export const isFrontend = (path) => path.startsWith("apps/desktop/");
export const isScript = (path) => /\.(?:mjs|cjs|js)$/.test(path);
export const isRust = (path) => path.endsWith(".rs");
export const isFrontendCode = (path) => isFrontend(path) && /\.(?:tsx?|jsx?)$/.test(path);
export const isDocument = (path) =>
  /\.(?:md|txt|rst)$/.test(path) || /^(?:LICENSE|NOTICE)(?:$|\.)/.test(path);

export function rustPackage(path) {
  const crate = /^crates\/([^/]+)\//.exec(path);
  return crate?.[1] ?? (path.startsWith("src-tauri/") ? "zyntax" : null);
}

export function scopesFor(changes, { all = false, reason = "", exportedPaths = [] } = {}) {
  const scope = {
    frontend: all,
    rust: all,
    tooling: all,
    workflow: all,
    contract: all,
    frontendTests: all ? "all" : [],
    toolingTests: all ? "all" : [],
    rustTests: all ? "all" : [],
    reason,
    paths: [...new Set(changes.flatMap((change) => [change.previous, change.current]))],
  };
  const exported = new Set(exportedPaths);
  const frontendTests = new Set();
  const toolingTests = new Set();
  const rustTests = new Set();
  for (const path of scope.paths) {
    if (isDocument(path) || /^(?:\.gitignore|\.gitattributes)$/.test(path)) continue;
    if (/^\.github\/workflows\//.test(path)) {
      scope.workflow = true;
      continue;
    }
    if (/^\.husky\//.test(path) || path === "commitlint.config.mjs") {
      scope.tooling = true;
      continue;
    }
    if (/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|biome\.json)$/.test(path)) {
      scope.frontend = scope.tooling = true;
      scope.frontendTests = scope.toolingTests = "all";
      continue;
    }
    if (path.startsWith("scripts/")) {
      scope.tooling = true;
      if (/\.test\.mjs$/.test(path)) toolingTests.add(path);
      if (/^scripts\/(?:check-|test-rust|bindings)/.test(path)) scope.toolingTests = "all";
      continue;
    }
    if (isFrontend(path)) {
      // CSS, images and prose do not need a TypeScript compilation.
      if (isFrontendCode(path) || /(?:package\.json|tsconfig[^/]*\.json)$/.test(path))
        scope.frontend = true;
      if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) frontendTests.add(path);
      if (
        /(?:vite\.config\.ts|vitest[^/]*|tsconfig[^/]*\.json|package\.json)$/.test(path) ||
        /\/(?:__tests__|test-utils|test-helpers|test\/setup)\//.test(path)
      )
        scope.frontendTests = "all";
      if (isBinding(path)) scope.contract = true;
      continue;
    }
    if (
      isRust(path) ||
      /(?:^|\/)(?:Cargo\.toml|Cargo\.lock)$/.test(path) ||
      /^(?:\.cargo\/|rust-toolchain)/.test(path) ||
      path.startsWith("src-tauri/")
    ) {
      scope.rust = true;
      if (/\/(?:tests|test_helpers)\//.test(path) || /(?:^|\/)tests?\.rs$/.test(path)) {
        const pkg = rustPackage(path);
        if (pkg) rustTests.add(pkg);
      }
      if (exported.has(path) || /(?:Cargo\.toml|Cargo\.lock)$/.test(path)) scope.contract = true;
      continue;
    }
    // Unknown code/configuration changes get conservative static checks, never a build.
    scope.frontend = scope.rust = scope.tooling = true;
    scope.reason ||= "Unclassified paths: conservative static checks";
  }
  if (scope.contract) scope.frontend = scope.rust = true;
  if (scope.frontendTests !== "all") scope.frontendTests = [...frontendTests];
  if (scope.toolingTests !== "all") scope.toolingTests = [...toolingTests];
  if (scope.rustTests !== "all") scope.rustTests = [...rustTests];
  return scope;
}

export function revisionChanges(root, base, head, { mergeBase = false } = {}) {
  try {
    if (!base || /^0+$/.test(base)) throw new Error("No base revision");
    // Validate refs before using them in diff; never reinterpret missing history as no changes.
    git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
    git(root, ["rev-parse", "--verify", `${head}^{commit}`]);
    const before = mergeBase ? git(root, ["merge-base", base, head]).trim() : base;
    const changes = parseChanges(
      git(root, ["diff", "--name-status", "-z", "--find-renames", before, head]),
    );
    const exportedPaths = changes
      .flatMap(({ previous, current }) => [previous, current])
      .filter((path) => hasExports(root, [before, head], path));
    return scopesFor(changes, { exportedPaths });
  } catch {
    return scopesFor([], { all: true, reason: "Missing comparison history: all checks and tests" });
  }
}
