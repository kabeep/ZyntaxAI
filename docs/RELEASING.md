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

## Version policy

Keep the current version unchanged during normal feature, fix and tooling work.
Only change it when preparing a release, in a dedicated commit whose entire message
is `Bump version MAJOR.MINOR.PATCH`, without a Conventional Commit prefix or body.
All other commits continue to use Conventional Commits. The matching tag is
`vMAJOR.MINOR.PATCH` and must point to that version commit.

Choose the release level from changes since the last released version, following
[SemVer 2.0.0](https://semver.org/):

- PATCH: backward-compatible bug fixes, such as `1.0.2` to `1.0.3`.
- MINOR: backward-compatible features; reset PATCH, such as `1.0.2` to `1.1.0`.
- MAJOR: incompatible changes to documented interfaces or persisted configuration;
  reset MINOR and PATCH, such as `1.0.2` to `2.0.0`.

Compatibility is a maintainer decision; a commit prefix or file extension cannot
determine it reliably. Validation enforces stable SemVer syntax (no leading zeroes),
numerical advancement and component resets. Prereleases/build metadata remain outside
this stable installer workflow. Never change or reuse a published version/tag.

Synchronize root `package.json`, `apps/desktop/package.json`, Cargo workspace
`Cargo.toml`, `src-tauri/tauri.conf.json` and the five workspace package entries in
`Cargo.lock`. Update the README version badge/download text and release changelog.
Preserve dependency versions and unrelated changes. Complete full release checks,
then commit and tag the reviewed release. Workflow validation requires the exact
bump message, matching metadata/tag, and an increase over the parent commit's version;
both automatic and manual release runs must target this dedicated version commit.

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

## Automatic GitHub release from a version tag

Push a stable `vMAJOR.MINOR.PATCH` tag pointing to the committed version you intend to distribute.
The tag must match all four metadata versions exactly; prerelease tags containing `-` do not trigger
this workflow. Push individual version tags, rather than publishing every local/upstream tag.
For example, after choosing `1.1.0` and updating the metadata as described above,
use Git Bash (these commands publish a release; do not run them during ordinary development):

```sh
git add package.json apps/desktop/package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json README.md CHANGELOG.md
git commit -m "Bump version 1.1.0"
git tag -a v1.1.0 -m "Bump version 1.1.0"
git push origin main
git push origin v1.1.0
```

The tag's commit must contain the Release workflow. All supported platforms are included:
Windows x86_64 (NSIS), macOS arm64/x86_64 (DMG), Linux x86_64 (Deb/AppImage). The pipeline checks
every platform, builds installers from the tag's exact commit, verifies files and source metadata,
uploads all attachments into a temporary draft, and only then publishes it automatically.
If checking/building/uploading fails, the release is not published; an upload failure may leave
a draft for retry. Rerun the failed workflow for the same tag/commit instead of moving the tag.
An already published release cannot be overwritten. Future releases require a new version/tag.

Release notes include Markdown commit subjects and links since the nearest published stable release
on the tagged commit's ancestry, plus a full diff link. Drafts, prereleases and unrelated branch
releases do not define this baseline. With no prior published ancestor, all commits through this
version are listed. The same content is attached as `COMMIT_CHANGES.md`; no npm publish is performed.
Source archives, notices, build instructions and checksum generation are unchanged. Automatic
GitHub release publication does not enable the desktop application's disabled updater.

## Manual GitHub draft release

1. Prepare the dedicated `Bump version MAJOR.MINOR.PATCH` commit, matching version tag and
   aligned metadata/lockfile described above. Push the commit; choose this exact ref for the draft.
2. On the fork's Actions page, select **Release**, then **Run workflow** on the intended ref.
   Windows and both macOS architectures are included; select Linux to also build Deb/AppImage.
   Notes are optional and passed as data, not shell commands.
3. The workflow validates metadata and rejects a published release or a tag bound to another commit.
   Each selected platform runs `pnpm check`, then builds ordinary installers without paid certificates. No updater
   private key, platform signing certificate or upstream publishing credentials are required.
4. Only after every platform succeeds does the workflow verify platform checksums, build commits,
   versions and notices; generate exact-commit source ZIP/tar.gz, SOURCE.md and combined checksums;
   and create/update a **draft** in `${GITHUB_REPOSITORY}` using that exact commit as its target.
   Generated commit changes also appear in the notes and `COMMIT_CHANGES.md` attachment.
5. Review and smoke-test downloaded installers, inspect their contents and corresponding source,
   then publish the draft manually. Manual workflow runs never auto-publish, even when run on a tag.

Only the final publishing job gets repository write permission. Runs are serialized per repository.
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
