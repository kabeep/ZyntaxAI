# Development checks

Install Node.js 22 or newer, the pnpm version declared in `package.json`, and
stable Rust with `clippy` and `rustfmt`. Desktop system dependencies are the same
as for Tauri development (C++ build tools on Windows, Xcode on macOS, WebKitGTK
and the packages listed in the checks workflow on Linux).

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm tauri build --debug --no-bundle
```

`pnpm install` installs Husky automatically. Each commit runs the full project
check: Biome lint, rustfmt, Clippy with warnings denied, Rust tests, generated
TypeScript binding consistency, TypeScript typechecking, and Vitest. The hook
never fixes or stages files. Stage the intended changes first; partial staging
and untracked files are rejected so checks examine the contents being committed.
Ignored build outputs and local files do not block commits.

Rust tests export ts-rs bindings to `apps/desktop/src/lib/bindings`. If the binding
check fails, review the generated changes, stage the required exports together
with their Rust definitions, and rerun the checks. Generated bindings are excluded
from Biome and remain checked by TypeScript.

Biome initially enforces common logic-error rules, not a formatting migration or
all recommended React/accessibility rules. Existing TypeScript strictness is
preserved. Extend the lint baseline in a separate, reviewed change.

Use Conventional Commits, for example `feat(providers): add request overrides`
or `test(format): support localized output`. The commit-msg hook uses commitlint.

The `Checks` workflow runs on pushes and pull requests on Windows, macOS, and
Linux. It runs the same checks and builds the desktop application without signing
or creating installers. It does not require API keys or release secrets. The
manual release workflow is separate.

Local hooks can be bypassed, so repository maintainers should require all three
`Check (...)` jobs in a GitHub branch ruleset before merging. Committing this
workflow does not configure GitHub branch protection automatically.
