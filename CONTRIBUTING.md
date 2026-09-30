# Development checks

Install Node.js 22.22.1 or newer, the pnpm version declared in `package.json`, and
stable Rust with `clippy` and `rustfmt`. Desktop system dependencies are the same
as for Tauri development (C++ build tools on Windows, Xcode on macOS, WebKitGTK
and the packages listed in the checks workflow on Linux).

```sh
pnpm install --frozen-lockfile
pnpm check:staged
```

`pnpm install` installs Husky automatically. Stage the intended changes first.
The pre-commit hook runs `pnpm check:staged`, using pinned lint-staged with
`hideAll`, its backup stash, and rollback enabled. Unstaged tracked changes and
non-ignored untracked files are temporarily hidden and restored. Partial staging
is supported. Tasks are read-only: no autofix, binding generation or added files.
An index/content guard rejects unexpected task modifications before auto-staging.

| Staged changes | Pre-commit checks |
| --- | --- |
| Frontend TS/TSX | Biome on existing staged files; whole-project `tsc --noEmit` once |
| Frontend deletion, types/config/dependencies | Project typecheck when the scope requires it; deleted files are not linted |
| Rust source | Workspace `cargo fmt --all -- --check`; no compilation |
| Scripts | Biome for scripts covered by its config; Node syntax checks |
| Docs, workflows, Cargo manifests alone, static assets | No unrelated source checks |

The commit-msg hook checks Conventional Commits. Rewording a commit does not run
pre-commit source checks. There is no automatic pre-push hook, Clippy, test suite
or application build in the commit path. Check tools must already be installed;
missing tools and failed checks block the commit instead of being ignored.

Avoid editing files while checks temporarily hide WIP. Normal check failures and
cooperative interrupts restore the original state. Force-killing Git/Node or a
power loss cannot guarantee cleanup: inspect `git status` and `git stash list`
for the lint-staged backup before further editing. Do not blindly drop backups.

## Choosing checks during development

```sh
pnpm check:worktree                      # static checks for staged paths, on current working files
pnpm check:related                       # explicitly request related behavior tests as well
pnpm check:worktree --tests               # all tests in the selected ecosystems
pnpm test -- src/lib/requestParameters.test.ts
pnpm rs:test --package zyntax-providers   # a Rust package, with exports isolated
pnpm checks:test                         # scope/hook/binding-check regression tests
pnpm release:test                        # release tooling tests
pnpm check                               # full verification, normally before a version tag
```

`check:worktree` and `check:related` select paths from the Git index but execute
against working files, including unfinished edits. They do not claim to verify
an isolated staged snapshot. Stage paths to select scope; an empty selection
does not run project checks. `check:related` uses Vitest's static import graph;
dynamic imports, IPC and cross-language behavior require explicit tests. Rust
related tests run the changed packages. UI text/CSS changes usually need visual
review, lint and applicable types, not a test suite or installer build.

For behavior changes, select tests that exercise the changed behavior and record
the result in the commit/PR description. A file extension or commit prefix cannot
reliably determine whether a behavior test is needed. Inline Rust tests also
need an explicit package/filter selection; the CI path rule recognizes separate
`tests/` and `test_helpers/` files, not Rust syntax-tree changes.

## Generated bindings

Rust tests export ts-rs bindings into ignored `target/validation-bindings`, never
the frontend source tree. Do not run export/test commands concurrently in the
same checkout. The verifier compares normalized LF/CRLF content and file names
with the Git index, including added, deleted and changed types. Cached exports
are rejected if Rust inputs changed.

```sh
pnpm bindings:verify      # fresh export tests and comparison; does not edit source
pnpm bindings:generate    # explicit source update; review and stage the result
pnpm bindings:check       # compare fresh complete exports from rs:test; no compilation
```

Stage required exports with their Rust definitions. Generated bindings are
excluded from Biome and remain checked by TypeScript.

Biome initially enforces common logic-error rules, not a formatting migration or
all recommended React/accessibility rules. Existing TypeScript strictness is
preserved. Extend the lint baseline in a separate, reviewed change.

Use Conventional Commits, for example `feat(providers): add request overrides`
or `test(format): support localized output`. The commit-msg hook uses commitlint.

## CI and release checks

`Checks` runs on branch pushes, pull requests and manual dispatch. Push comparison
uses before/after commits (including force pushes); PRs use the merge base. Full
history, rename paths and deletions are considered. Missing history falls back
to all checks/tests with a reason; it never means "nothing changed".

| Scope | CI |
| --- | --- |
| Frontend | Windows: Biome, project TypeScript; no Rust tooling |
| Rust | Windows/macOS/Linux: rustfmt and workspace Clippy with warnings denied |
| Tooling | Windows: script lint, Node syntax and selected Node tests |
| Workflows | Pinned actionlint; no mandatory local Go installation |
| Exported Rust types / bindings / Cargo dependencies | Rust and frontend checks plus fresh binding verification |
| Docs / static assets | Other jobs skipped; stable `Checks result` still reports success |

Changed test files select their tests; test/config/helper changes expand the
relevant test scope. Shared Node dependencies expand frontend/tooling checks and
tests. Validation script changes select the tooling regression suite. Ordinary
source changes do not automatically run all tests. Unknown paths conservatively
select static checks, with a reason. Manual dispatch can request all tests.

Ordinary CI does not build the application. `Release` still runs `pnpm check`
and platform installer builds for version tags; manual releases keep their
existing draft behavior. See [docs/RELEASING.md](docs/RELEASING.md). Changes to
bundling, native dependencies or packaging may justify an explicit targeted
build during development; do not wait for release to investigate such issues.

Local hooks can be bypassed. Require **Checks result** in a GitHub branch ruleset
before merging; the aggregate job fails on failed/cancelled applicable jobs and
allows unrelated jobs to be skipped. Committing the workflow does not configure
GitHub branch protection automatically. Checks require no API keys or release
secrets.
