import { execFileSync } from "node:child_process";

// Check the same contents Git will commit, without stashing or rewriting files.
const changed = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
if (changed.trim() || untracked.trim()) {
  console.error("Commit checks require all intended changes to be staged and no untracked files.\nStage intended files; keep unrelated work in a separate checkout.\n" + changed + untracked);
  process.exit(1);
}
