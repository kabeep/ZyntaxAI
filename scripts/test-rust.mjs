import { git } from "./check-scopes.mjs";
import { runRustTests } from "./bindings.mjs";

try {
  runRustTests(git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim(), process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
