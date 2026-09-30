# Releasing this fork

The fork is maintained at https://github.com/kabeep/ZyntaxAI. Downloads belong on its Releases
page. Upstream authorship, copyright notices, LICENSE and licence/absence-of-warranty notices
must be retained. Record dated modifications in CHANGELOG.md and retain GPL-3.0-or-later licensing.

## Before publishing an installer

1. Run `pnpm check` and complete the supported-platform build checks.
2. Choose a distinct fork version and keep the package, workspace and Tauri version metadata aligned.
3. Build from a clean, recorded commit. Create a release tag pointing to that exact commit; do not
   reuse an unrelated upstream tag or a moving branch as the source reference.
4. Make the complete corresponding source available without additional charge, including the
   modified code and the scripts/configuration needed to build and install it. Account for required
   non-system dependencies and their notices; a fork repository alone is not a dependency licence audit.
5. Next to each installer in the release notes, provide the exact commit, immutable source/tag
   link and source archive links. The source must correspond to the distributed binary; just linking
   to the upstream repository or the fork's current main branch is insufficient.
6. Include LICENSE, NOTICE and modification notices with the distribution. Keep corresponding source
   accessible for as long as required while offering the binaries. Inspect the actual installer
   contents before publishing; this guide is not a certification of every packaged dependency.

Suggested release-note fields: fork version, build commit, source tag, corresponding-source
ZIP/tarball, build instructions, dated changes, GPL-3.0-or-later and no-warranty notice.
Do not publish a release with unresolved placeholder fields.

## Local installer build

`pnpm tauri build --no-bundle` produces an optimized executable. To produce the release installers
and notices for your current platform from a clean committed checkout, use Git Bash:

```sh
pnpm check
pnpm release
```

The script stages installers in `dist/release/<version>/<platform>/`, alongside LICENSE, NOTICE,
BUILDINFO and platform-specific SHA256 checksums. It honours `CARGO_TARGET_DIR`, builds with the
Cargo lockfile enforced, and clears only its platform bundle/staging directories to exclude stale
installers. It never uploads. Supported targets: Windows x86_64 (NSIS), macOS arm64/x86_64 (DMG),
Linux x86_64 (Deb/AppImage). Use `pnpm release --target <Rust triple>` only with that target's build
tools installed on the appropriate host. Windows/Linux cross-host packaging is not supported.

## GitHub draft release

1. Commit the desired version and push it to the fork. Align all four version fields: root package,
   desktop package, Cargo workspace and Tauri configuration; update Cargo.lock too.
2. On the fork's Actions page, select **Release**, then **Run workflow** on the intended ref.
   Windows and both macOS architectures are included; select Linux to also build Deb/AppImage.
   Notes are optional and passed as data, not shell commands.
3. The workflow validates metadata and rejects a published release or a tag bound to another commit.
   Each selected platform runs `pnpm check`, then builds ordinary installers without paid certificates. No updater
   private key, platform signing certificate or upstream publishing credentials are required.
4. Only after every platform succeeds does the workflow verify platform checksums, build commits,
   versions and notices; generate exact-commit source ZIP/tar.gz, SOURCE.md and combined checksums;
   and create/update a **draft** in `${GITHUB_REPOSITORY}` using that exact commit as its target.
5. Review and smoke-test downloaded installers, inspect their contents and corresponding source,
   then publish the draft manually. The workflow never makes a release public automatically.

Only the final draft job gets repository write permission. Runs are serialized per repository.
A retry may overwrite assets only on a draft for the same source commit/version; unexpected old
assets require review. Published versions must use a new version/tag instead. Do not publish a
draft while its workflow is still running. GitHub Actions artifact storage is temporary (7 days)
and may be accessible to repository readers before the draft is published.

Windows installers are unsigned; macOS uses certificate-free ad-hoc signing (identity `-`), which
is needed for Apple Silicon but is not Apple notarization. Windows SmartScreen/macOS Gatekeeper
warnings may remain. Updater signing is omitted and is separate from operating-system code signing. Automatic update
checks remain disabled, and the retained updater plugin/endpoints do not become a fork update channel.
The inherited `site:sync` and `zyntaxai/PUBLISHING.md` tooling is for upstream website distribution;
it is not part of the fork's GitHub release pipeline. Dependency licensing and installation acceptance
still require release review; successful CI alone does not certify them.

References: [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html),
[GNU corresponding-source FAQ](https://www.gnu.org/licenses/gpl-faq.html#DistributeExtendedBinary).
