---
title: AOS CE workspace
description: Navigate the monorepo, shared dependencies, distro composition, and product-owned crates.
part: Orientation
order: 25
---

The public Community Edition repository is the source workspace for the open AOS
product. Clone it with the full Git history and use the committed lockfile.

```sh
git clone https://github.com/unicity-aos/aos-ce.git
cd aos-ce
cargo check --locked --workspace
```

## Repository map

```text
aos-ce/
├── crates/
│   └── unicity-aos-bootstrap/   # product CLI, home, migration, and health
├── capsules/
│   ├── capsule-react/
│   ├── capsule-session/
│   └── ...                      # first-party product components
├── distros/community/unicity-ce/
│   └── Distro.toml              # Community Edition composition
├── Cargo.toml                   # workspace members and shared dependencies
└── Cargo.lock                   # reproducible dependency graph
```

Enterprise Edition is composed privately over the same open runtime. Private
enterprise components do not belong in the CE repository, and Enterprise must
not carry a fork of Astrid Runtime.

## Workspace dependency policy

Put dependency versions shared by multiple capsules in root
`[workspace.dependencies]`, then consume them with `workspace = true`. Keep a
local version only when the capsule genuinely requires a different contract.

```toml
[dependencies]
astrid-sdk = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
```

Run workspace-wide checks after changing shared dependencies because a small
SDK bump can change generated bindings for every capsule.

```sh
cargo fmt --all -- --check
cargo check --locked --workspace
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
```

Capsules target `wasm32-unknown-unknown` through their checked-in
`.cargo/config.toml`. Do not force a host target into the release artifact. Host
unit tests should isolate pure logic into modules that can compile natively.

## Product state

The AOS product home is `~/.aos`; the bundled runtime lives below
`~/.aos/runtime`. Project state also uses `.aos` instead of the
standalone runtime's `.astrid`. The `aos` process selects both locations only
for the child runtime. It does not mutate the user's shell environment or claim
a standalone Astrid installation.
