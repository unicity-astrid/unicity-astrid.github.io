---
title: Continuous integration
description: Gate capsule and product changes with formatting, tests, linting, packaging, and runtime smoke coverage.
part: Ship and release
order: 80
---

CI should fail at the earliest useful boundary and still prove the final artifact.
Separate fast workspace feedback from packaging and end-to-end release jobs.

## Pull-request gates

Run for every Rust change:

```sh
cargo fmt --all -- --check
cargo check --locked --workspace
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
```

Also build each capsule with its checked-in target configuration. A host-only
workspace pass does not prove the WebAssembly component compiles.

## Contract gates

When SDK or WIT inputs change:

- verify generated WIT mirrors are current;
- build every consuming capsule;
- compare the public API and WIT contract surface;
- reject an unversioned incompatible change;
- test both the oldest and newest supported runtime where the range spans them.

## Artifact gates

For each release candidate:

1. build from a clean checkout with `--locked`;
2. produce the `.capsule`, not only raw `.wasm`;
3. inspect the package manifest;
4. calculate and record its digest;
5. install into an isolated AOS home;
6. execute success and denial smoke tests;
7. upload only after every capsule passes.

Run matrix jobs for Linux and macOS when host tooling differs. Do not claim
Windows support from a Rust cross-compile alone; the product needs state paths,
IPC, services, installer, and end-to-end tests on Windows.

## Product-site gates

The website is part of the release contract. It must pass both:

```sh
npm run check
npm run build
```

Validate that installer metadata names the same AOS version as release assets,
that the command downloads the product rather than a standalone runtime, and
that the developer-guide index contains working `/developers/...` URLs.

## Secrets and logs

Use least-privilege workflow tokens, pin third-party actions to reviewed
revisions according to repository policy, and never echo signing material. Keep
release jobs protected from untrusted fork code.
