---
title: Get started with AOS CE
description: Prepare the Community Edition workspace today and use the signed product release path when it opens.
part: Orientation
order: 10
---

Unicity AOS Community Edition is the public product distribution. Its command is
`aos`; its product home is `~/.unicity-os`; its private bundled runtime lives at
`~/.unicity-os/runtime`.

## Release status

AOS `2026.1.0` is the product version being prepared. Until its signed product
archives, checksums, and installer are published, use the source workspace for
development and treat the Install page as release staging rather than a live
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
```

The installer selects a platform archive named
`unicity-aos-<target>.tar.gz`, verifies it against `SHA256SUMS.txt`, and installs
the product and its pinned runtime together.

## Initialize Community Edition

After the product release is installed:

```sh
aos init
```

The release also publishes the Homebrew formula:

```sh
brew install unicity-aos/tap/aos
```

The tap repository and formula automation can exist before the formula itself;
the command is supported only after the `2026.1.0` release dispatch publishes
and verifies the formula.

`aos init` materializes the Unicity CE manifest embedded in the same product
release. It does not fetch a mutable manifest from `main`. The wrapper sets
the product runtime home and `.unicity-os` project layout only for its child
runtime, so standalone Astrid state remains separate.

For unattended initialization, review the variables and requested capabilities
before using `--yes`. Use `UNICITY_AOS_HOME` for disposable CI state.

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

## Existing standalone runtime

On an interactive first run, `aos` may detect `~/.astrid` and ask whether to copy
compatible state. Declining is safe. The source is not renamed or deleted, and
you can run the explicit migration later. Read [Migrate an existing runtime](/developers/migration/)
before importing production state.
