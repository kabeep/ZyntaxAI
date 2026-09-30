import { isVersionBump } from "./scripts/release-utils.mjs";

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [isVersionBump],
};
