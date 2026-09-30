import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import lintStaged from "lint-staged";
import {
  git,
  isBinding,
  isFrontendCode,
  isRust,
  isScript,
  stagedChanges,
} from "./check-scopes.mjs";
import { frontendTypes, lintFiles, run, syntaxFiles } from "./check-tools.mjs";

export function fastFiles(changes) {
  const paths = [
    ...new Set(
      changes.filter(({ status }) => !status.startsWith("D")).map(({ current }) => current),
    ),
  ];
  return {
    lint: paths.filter(
      (path) =>
        !isBinding(path) &&
        (isFrontendCode(path) || (path.startsWith("scripts/") && isScript(path))),
    ),
    syntax: paths.filter(isScript),
    rust: paths.filter(isRust),
  };
}

export function needsTypes(changes) {
  return changes.some(({ previous, current }) =>
    [previous, current].some(
      (path) =>
        isFrontendCode(path) ||
        /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(path) ||
        /^apps\/desktop\/(?:tsconfig[^/]*\.json|package\.json)$/.test(path),
    ),
  );
}

export async function checkStaged(root, { task, quiet = false } = {}) {
  const changes = stagedChanges(root);
  const files = fastFiles(changes);
  const typecheck = needsTypes(changes);
  const formatRust = changes.some(({ previous, current }) => isRust(previous) || isRust(current));
  if (!task && !Object.values(files).some((paths) => paths.length) && !typecheck && !formatRust) {
    console.log("No staged source checks needed; commit message is checked separately.");
    return true;
  }
  const before = git(root, ["write-tree"]).trim();
  const ok = await lintStaged({
    cwd: root,
    concurrent: false,
    diffFilter: "ACMRDT",
    hideAll: true,
    stash: true,
    revert: true,
    quiet,
    // Function task receives arrays, so spaces/metacharacters never become shell code.
    // One glob and no argument chunking prevent duplicate project/task execution.
    maxArgLength: Number.MAX_SAFE_INTEGER,
    config: {
      "*": {
        title: "Read-only staged source checks",
        task: async () => {
          if (task) await task(files);
          else {
            lintFiles(root, files.lint);
            syntaxFiles(root, files.syntax);
            if (typecheck) frontendTypes(root);
            if (formatRust) run(root, "cargo", ["fmt", "--all", "--", "--check"]);
          }
          // Reject modifications before lint-staged can auto-stage task output.
          if (
            git(root, ["write-tree"]).trim() !== before ||
            git(root, ["diff", "--name-only", "-z"]) ||
            git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
          ) {
            throw new Error("Read-only checks modified files or the index");
          }
        },
      },
    },
  });
  if (git(root, ["write-tree"]).trim() !== before)
    throw new Error("Checks changed the Git index; inspect it before committing");
  return ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = (await checkStaged(
      git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim(),
    ))
      ? 0
      : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
