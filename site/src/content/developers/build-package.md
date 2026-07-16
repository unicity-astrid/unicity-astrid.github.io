---
title: Build and package
description: Produce a reproducible WebAssembly component and an installable capsule artifact.
part: Ship and release
order: 70
---

There are two different build outputs. A raw WebAssembly file proves the Rust
component compiles. An installable `.capsule` bundles the component, manifest,
metadata, and verification material expected by the runtime.

## Compile the component

Run from the capsule directory so `.cargo/config.toml` selects
`wasm32-unknown-unknown` and the repository's `getrandom` backend configuration.

```sh
cargo build --release
```

Do not install the `.wasm` directly and do not rename it by hand to `.capsule`.
That skips component packaging and verification.

## Build the artifact

Use the released Astrid build tooling through the product's pinned development
environment:

```sh
aos capsule build
```

The supported build produces an artifact under `dist/`. The exact filename is
derived from the package identity and version; automation should discover it
from the build output or a manifest, not guess it.

Before release, verify:

- every `[[component]].file` exists in the package;
- the component imports only declared WIT contracts;
- manifest and component versions agree;
- the runtime compatibility range covers the pinned AOS runtime;
- no source maps, local paths, secrets, or test fixtures leaked into the bundle;
- a clean checkout produces the same content digest.

## Reproducibility

Use the committed `Cargo.lock`, pinned toolchain, released SDK, and a clean
working tree. Do not package with an unpublished path dependency.

```sh
cargo build --locked --release
git diff --exit-code
```

Record the source commit, toolchain, artifact digest, and dependency lock in the
release attestation. Signing identifies what was published; reproducibility lets
another developer prove how it was produced.

## Smoke installation

Create a temporary product home, install the artifact through the normal runtime
surface, invoke one success path, and exercise at least one denied capability.
Do not reuse a developer's live `~/.aos` in CI.

The product release should stage every capsule artifact first, verify all
digests, then compose the distro lock. Never resolve Community Edition from
mutable repository branches during end-user installation.
