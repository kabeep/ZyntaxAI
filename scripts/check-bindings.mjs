import { generateBindings, runRustTests, verifyBindings } from "./bindings.mjs";
import { git } from "./check-scopes.mjs";

try {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const mode = process.argv[2];
  if (mode && !["--verify", "--generate"].includes(mode))
    throw new Error("Expected --verify or --generate");
  if (mode) runRustTests(root, ["export_bindings"]);
  if (mode === "--generate") generateBindings(root);
  else verifyBindings(root);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
