---
title: Compose capsules into AOS
description: Add a first-party capsule to the workspace and Community Edition.
part: Build capsules
order: 30
---

A capsule is one isolated ability in AOS. Community Edition selects a tested set
of capsules and grants each one the capabilities it needs. The Astrid SDK, WIT
contracts, sandbox, and artifact format provide the common runtime surface.

## Add the workspace member

Create `capsules/capsule-<name>` and add it to root `workspace.members`. Reuse
root dependency versions wherever possible. Every capsule has its own
`Cargo.toml`, `Capsule.toml`, source, tests, and README, while the workspace has
one committed dependency lock.

```sh
cargo check --locked --workspace
```

Finish the component itself using the chapters on [capsule anatomy](/developers/capsule-anatomy/),
[manifest authority](/developers/manifest/), and [IPC contracts](/developers/ipc/).

## Add the distro entry

Community Edition composition lives in
`distros/community/unicity-ce/Distro.toml`. The first product release packages
verified `.capsule` artifacts beside the distro under `capsules/`; pin the
artifact version and reference that release-local path.

```toml
[[capsule]]
name = "astrid-capsule-example"
source = "capsules/astrid-capsule-example.capsule"
version = "0.1.0"
```

Add `role = "uplink"` for a frontend. Use a named `group` for mutually selected
providers. Supply product defaults through `env` placeholders rather than
hard-coding credentials in the capsule.

```toml
[variables]
example_endpoint = { description = "Example service base URL", default = "https://example.invalid" }

[[capsule]]
name = "astrid-capsule-example"
source = "capsules/astrid-capsule-example.capsule"
version = "0.1.0"
env = { endpoint = "{{ example_endpoint }}" }
```

The public capsule registry is not live yet. Do not put a registry namespace in
the CE manifest until that namespace resolves to signed, immutable artifacts.

## Validate the composition

The distro is a graph. Installing a capsule is insufficient if its subscribed
topics have no publisher, its WIT requirements are unsatisfied, or its provider
group has no selected member.

Check:

- package version matches the built artifact;
- all required WIT packages fall within distro compatibility;
- publish and subscribe topics have intended peers;
- requested host capabilities are explainable during onboarding;
- environment variables resolve without exposing secrets;
- clean initialization installs the complete CE set;
- removing the capsule leaves the remaining distro coherent.

## Keep runtime contracts generic

Add product behavior through capsules and distro policy. If the change needs a
generic WIT contract, SDK capability, kernel operation, or sandbox behavior,
design it upstream in Astrid Runtime and consume a released version.

Published crate names, `astrid:*` namespaces, `@unicity-astrid` WIT identities,
and signed artifact names remain compatibility contracts. Product prose and
descriptions say AOS; identifiers change only through a deliberate compatible
protocol migration.
