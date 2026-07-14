---
title: Editions and releases
description: Ship compatible Community and Enterprise product releases with pinned runtime assets.
part: Ship and release
order: 90
---

Unicity AOS versions independently from Astrid Runtime. Product releases use
calendar SemVer: `2026.1.0` is the first stable 2026 release; compatible fixes
advance the patch and compatible product features advance the minor.

## Release identity

The Git tag and product version are `2026.1.0` with no `v` prefix. Release
archives use:

```text
unicity-aos-<target>.tar.gz
```

Each archive contains the product CLI and the exact runtime toolchain it wraps:

```text
bin/aos
runtime/bin/astrid
runtime/bin/astrid-daemon
runtime/bin/astrid-build
runtime/bin/astrid-emit
```

`SHA256SUMS.txt` covers every archive. The release workflow signs the supported
verification material according to product policy before the installer is
enabled.

## Supported targets

The initial artifact matrix contains four macOS/Linux targets. A target is
supported only when the product CLI, daemon, IPC, installer, state paths, and
end-to-end smoke tests pass on it. Cross-compiling a binary is not enough to
claim support.

## Coupled versions

Every AOS release records:

- AOS product version and source commit;
- Astrid Runtime version and source provenance;
- WIT contract compatibility range;
- capsule versions and artifact digests in the CE composition;
- archive digest and signing proof;
- installer version or commit that understands the archive layout.

The installer resolves only immutable assets from the matching AOS release. It
does not fetch capsule composition or runtime binaries from mutable `main`.

## Release sequence

1. Freeze and test the CE workspace lock.
2. Build and verify every capsule artifact.
3. Build the four product archives from the pinned runtime release.
4. Smoke-test clean install, upgrade, migration, `aos init`, delegated commands,
   and uninstall or rollback behavior.
5. Publish archives and `SHA256SUMS.txt` under tag `2026.1.0`.
6. Test the canonical root `install.sh` against the published release.
7. Dispatch and verify `brew install unicity-aos/tap/aos` from the release tap.
8. Enable the website release switch and installer copy actions.
9. Verify `curl --proto '=https' --tlsv1.2 -fsSL https://aos.unicity.ai/install.sh | sh` on every target.

Website metadata, `aos --version`, archive tag, and documentation must agree.

## Editions

Community Edition is the public `aos-ce` product composition. Enterprise is a
private product composition built above the same open Astrid Runtime. Enterprise
may add private capsules, support tooling, and services; it does not fork the
open engine or place private source in the CE repository.

## Updates

`aos self-update` does not delegate to Astrid's standalone updater. Product
updates replace the AOS CLI and bundled runtime as one verified unit, then run
compatibility checks before restarting services. A partial update that replaces
only `astrid` can violate the product's tested runtime and WIT matrix.
