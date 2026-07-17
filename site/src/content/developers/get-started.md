---
title: Get started with AOS CE
description: Prepare the Community Edition workspace today and use the signed product release path when it opens.
part: Orientation
order: 10
---

Unicity AOS Community Edition is the public product distribution. Its command is
`aos`; its product home is `~/.aos`; its private bundled runtime lives at
`~/.aos/runtime`.

## Install AOS

Stable is the installer default. Development and nightly are always explicit:

```sh
# Stable
curl -fsSL https://aos.unicity.ai/install.sh | sh

# Explicit prerelease channels
curl -fsSL https://aos.unicity.ai/install.sh | sh -s -- --channel dev
curl -fsSL https://aos.unicity.ai/install.sh | sh -s -- --channel nightly
```

An unavailable channel must stop without installing or falling back to another
channel.

```sh
git clone https://github.com/unicity-aos/aos-ce.git
cd aos-ce
cargo check --locked --workspace
cargo test --locked -p unicity-aos-bootstrap
```

Do not use `cargo install astrid` as an AOS installation. That installs a
standalone runtime CLI and does not provide the AOS product wrapper, embedded
Community Edition manifest, product home, or coordinated update policy.

## Product release layout

The signed release archive contains:

```text
bin/aos
runtime/bin/astrid
runtime/bin/astrid-daemon
runtime/bin/astrid-build
runtime/bin/astrid-emit
Distro.toml
capsule-assets.txt
capsules/*.capsule
```

The installer selects a platform archive named
`unicity-aos-<target>.tar.gz`, verifies the signed release identity and archive,
and installs the product, pinned runtime, and Community Edition capsule set
together.

Verification passes the archive itself to `cosign verify-blob`, binding the
downloaded bytes to the AOS release workflow identity and immutable calendar
version tag before extraction. The release publishes `BLAKE3SUMS.txt` as its
primary digest inventory and `SHA256SUMS.txt` for compatibility with external
tooling such as Homebrew.

The archive's schema-2 `release-manifest.json` records the Astrid Runtime input as
`runtime.digest = "blake3:<64 lowercase hex>"`. The installer does not substitute
a detached checksum comparison for direct Sigstore archive verification.

## Start a host plugin

No manual `aos init` is required for Claude Code, Codex, or Grok Build. Start a
selected host after installation. Its plugin provisions only that host's named
principal and Oracle pack.

`aos init` remains available when an operator deliberately wants a standalone
Community Edition administration workspace:

```sh
aos init
```

The release also publishes the Homebrew formula:

```sh
brew install unicity-aos/tap/aos
```

The tap repository and formula automation can exist before the formula itself.
The command works only after the stable release publishes and verifies it.

`aos init` materializes the Unicity CE manifest installed from the same product
release. It does not fetch a mutable manifest from `main`. The wrapper sets
the product runtime home and `.aos` project layout only for its child
runtime, so standalone Astrid state remains separate.

For unattended initialization, review the variables and requested capabilities
before using `--yes`. Use `AOS_HOME` for disposable CI state.

## Verify the installation

```sh
aos --version
aos status
aos doctor
aos capsule list
```

If the health service is enabled:

```sh
curl --fail http://127.0.0.1:8765/v1/runtime/health
```

A ready response proves the local product runtime is reachable. It does not
prove that every provider credential, external service, or optional capsule is
ready; use delegated runtime readiness and product diagnostics for those.

## A clean product home

AOS creates `~/.aos` and provisions Community Edition from scratch. It does not
import, rename, rewrite, or delete a standalone `~/.astrid` installation. The two
homes can coexist, which makes a first AOS install safe to evaluate and remove
without changing an existing Astrid setup.
