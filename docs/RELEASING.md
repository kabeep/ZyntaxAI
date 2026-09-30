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

## Current build tooling

`pnpm tauri build --no-bundle` produces an optimized executable. For a Windows NSIS installer
without updater-signature artifacts, use Git Bash:

```sh
pnpm tauri build --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The inherited `pnpm release`, Release workflow and site-sync tooling still target the upstream
update infrastructure. They have not been adapted into a fork release pipeline and must be
reviewed before use. This fork's update checks and installation operations are disabled.
Changing About links does not create a release or configure an automatic update channel.

References: [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html),
[GNU corresponding-source FAQ](https://www.gnu.org/licenses/gpl-faq.html#DistributeExtendedBinary).
