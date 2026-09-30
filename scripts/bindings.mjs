import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { git } from "./check-scopes.mjs";

export const bindingPath = "apps/desktop/src/lib/bindings/";
export const exportPath = "target/validation-bindings";

export function sourceFingerprint(root) {
  const hash = createHash("sha256");
  const paths = git(root, ["ls-files", "-z"])
    .split("\0")
    .filter((path) => /(?:\.rs|Cargo\.toml|Cargo\.lock)$/.test(path) || path.startsWith(".cargo/"))
    .sort();
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)) : "<deleted>");
  }
  return hash.digest("hex");
}

export function clearExports(root) {
  const directory = resolve(root, exportPath);
  const parent = resolve(root, "target");
  if (!directory.startsWith(`${parent}${sep}`)) throw new Error("Unsafe bindings output directory");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function exportedFiles(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix + entry.name;
      if (entry.isDirectory()) return exportedFiles(resolve(directory, entry.name), `${path}/`);
      return path.endsWith(".ts") ? [path] : [];
    })
    .sort();
}

export const normalizeBinding = (text) => text.replace(/\r\n/g, "\n");

export function compareBindings(expected, generated) {
  return [...new Set([...Object.keys(expected), ...Object.keys(generated)])]
    .sort()
    .filter(
      (path) =>
        expected[path] === undefined ||
        generated[path] === undefined ||
        normalizeBinding(expected[path]) !== normalizeBinding(generated[path]),
    );
}

export function runRustTests(root, args = []) {
  const directory = clearExports(root);
  const source = sourceFingerprint(root);
  const packageSelection = args.some(
    (arg) => ["-p", "--package", "--exclude"].includes(arg) || /^--package=/.test(arg),
  );
  execFileSync(
    "cargo",
    ["test", ...(packageSelection ? [] : ["--workspace"]), "--locked", ...args],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, TS_RS_EXPORT_DIR: directory },
    },
  );
  if (sourceFingerprint(root) !== source)
    throw new Error("Rust sources changed during testing; rerun the check");
  if (!packageSelection) writeFileSync(resolve(directory, ".complete"), JSON.stringify({ source }));
}

export function verifyBindings(root) {
  const directory = resolve(root, exportPath);
  if (!existsSync(resolve(directory, ".complete")))
    throw new Error("No complete exports; run pnpm bindings:verify or pnpm rs:test first");
  if (
    JSON.parse(readFileSync(resolve(directory, ".complete"), "utf8")).source !==
    sourceFingerprint(root)
  ) {
    throw new Error("Rust sources changed since export; run pnpm bindings:verify");
  }
  const expected = {};
  for (const path of git(root, ["ls-files", "-z", "--", bindingPath]).split("\0").filter(Boolean)) {
    expected[path.slice(bindingPath.length)] = git(root, ["show", `:${path}`]);
  }
  const generated = Object.fromEntries(
    exportedFiles(directory).map((path) => [path, readFileSync(resolve(directory, path), "utf8")]),
  );
  const changed = compareBindings(expected, generated);
  if (changed.length)
    throw new Error(
      `Bindings differ from the Git index:\n${changed.join("\n")}\nRun pnpm bindings:generate, review and stage the exports.`,
    );
  console.log(`Verified ${Object.keys(generated).length} bindings without modifying source files.`);
}

export function generateBindings(root) {
  const directory = resolve(root, exportPath);
  const destination = resolve(root, bindingPath);
  const files = exportedFiles(directory);
  for (const path of git(root, ["ls-files", "-z", "--", bindingPath]).split("\0").filter(Boolean)) {
    if (!files.includes(path.slice(bindingPath.length))) {
      const absolute = resolve(root, path);
      if (!absolute.startsWith(`${destination}${sep}`)) throw new Error("Unsafe binding path");
      rmSync(absolute, { force: true });
    }
  }
  for (const path of files) {
    const absolute = resolve(destination, path);
    if (relative(destination, absolute).startsWith(".."))
      throw new Error("Unsafe generated binding path");
    mkdirSync(resolve(absolute, ".."), { recursive: true });
    writeFileSync(absolute, normalizeBinding(readFileSync(resolve(directory, path), "utf8")));
  }
  console.log("Updated source bindings. Review and stage them explicitly.");
}
