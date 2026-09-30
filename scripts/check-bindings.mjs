import { execFileSync } from "node:child_process";

const directory = "apps/desktop/src/lib/bindings";
// cargo test exports ts-rs bindings. Compare them to the index, allowing newly
// staged bindings while rejecting stale or missing exports and untracked files.
const changed = execFileSync("git", ["diff", "--name-only", "--", directory], { encoding: "utf8" });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", directory], { encoding: "utf8" });
if (changed.trim() || untracked.trim()) {
  console.error("Generated TypeScript bindings changed. Review and stage the exports, then rerun checks.\n" + changed + untracked);
  process.exit(1);
}
