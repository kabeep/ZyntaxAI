import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync("cargo", ["test", "--workspace", "--locked"], {
  stdio: "inherit",
  env: {
    ...process.env,
    TS_RS_EXPORT_DIR: fileURLToPath(new URL("../apps/desktop/src/lib/bindings/", import.meta.url)),
  },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
