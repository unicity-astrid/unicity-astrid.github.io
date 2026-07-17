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

The release workflow publishes BLAKE3 and SHA-256 compatibility manifests and
signs the supported verification material according to product policy before an
installer channel is enabled.

`BLAKE3SUMS.txt` is the primary AOS-owned digest inventory and covers every
product archive and capsule. `SHA256SUMS.txt` covers the same release assets for
ecosystem compatibility, including Homebrew. The installer verifies the
downloaded archive itself with its Sigstore bundle and the expected AOS release
workflow identity; neither digest manifest substitutes for signature
verification.

Each archive also carries a schema-2 `release-manifest.json`. Its
`runtime.digest` is the canonical algorithm-tagged BLAKE3 digest
`blake3:<64 lowercase hex>` of the Astrid Runtime archive used to compose that
product release.

## Installer channels

Stable is the default. Dev and nightly must be selected explicitly:

```sh
# Stable default
curl -fsSL https://aos.unicity.ai/install.sh | sh

# Explicit prerelease channels
curl -fsSL https://aos.unicity.ai/install.sh | sh -s -- --channel dev
curl -fsSL https://aos.unicity.ai/install.sh | sh -s -- --channel nightly
```

Stable is live for `2026.1.0`. Dev and nightly remain closed until their signed
channel pointers are published. The installer must resolve a selected channel to
signed release metadata and an immutable tag. Missing, invalid, or mismatched
channel metadata stops installation; it never falls back to another channel.

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
- algorithm-tagged archive and component digests plus signing proof;
- installer version or commit that understands the archive layout.

The installer resolves only immutable assets from the matching AOS release. It
does not fetch capsule composition or runtime binaries from mutable `main`.

## Release sequence

1. Freeze and test the CE workspace lock.
2. Build and verify every capsule artifact.
3. Build the four product archives from the pinned runtime release.
4. Smoke-test clean install, reinstall/self-heal, upgrade, `aos init`, delegated commands,
   and uninstall or rollback behavior.
5. Publish archives, capsules, `BLAKE3SUMS.txt`, `SHA256SUMS.txt`, Sigstore
   bundles, and compatibility metadata under tag `2026.1.0`.
6. Test the canonical root `install.sh` against the published release.
7. Dispatch and verify `brew install unicity-aos/tap/aos` from the release tap.
8. Promote signed stable-channel metadata, then enable the website release switch
   and installer copy actions.
9. Verify `curl -fsSL https://aos.unicity.ai/install.sh | sh` on every target.

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
