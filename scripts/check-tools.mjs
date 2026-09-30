import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export function run(root, command, args, options = {}) {
  console.log(`Checking: ${command === process.execPath ? "node" : command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

export function nodeTool(root, packageName, entry, args, cwd = root) {
  const require = createRequire(resolve(root, "package.json"));
  const manifest = require.resolve(`${packageName}/package.json`, { paths: [cwd, root] });
  run(cwd, process.execPath, [resolve(manifest, "..", entry), ...args]);
}

// Keep argument vectors bounded on Windows without interpolating filenames into a shell.
export function batches(paths, limit = 6000) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const path of paths) {
    if (size + path.length + 3 > limit && current.length) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(path);
    size += path.length + 3;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function lintFiles(root, paths) {
  const present = [...new Set(paths)].filter((path) => existsSync(resolve(root, path)));
  for (const group of batches(present)) {
    nodeTool(root, "@biomejs/biome", "bin/biome", [
      "lint",
      "--error-on-warnings",
      "--no-errors-on-unmatched",
      ...group,
    ]);
  }
}

export function syntaxFiles(root, paths) {
  for (const path of paths)
    if (existsSync(resolve(root, path))) run(root, process.execPath, ["--check", path]);
}

export function frontendTypes(root) {
  nodeTool(root, "typescript", "bin/tsc", ["--noEmit"], resolve(root, "apps/desktop"));
}

export function frontendTests(root, selection, { related = false } = {}) {
  if (selection !== "all" && selection.length === 0) return;
  const desktop = resolve(root, "apps/desktop");
  const paths =
    selection === "all" ? [] : selection.map((path) => resolve(root, path)).filter(existsSync);
  if (selection !== "all" && paths.length === 0) return;
  const args =
    related && selection !== "all"
      ? ["related", "--run", "--passWithNoTests", ...paths]
      : ["run", ...paths];
  nodeTool(root, "vitest", "vitest.mjs", args, desktop);
}
