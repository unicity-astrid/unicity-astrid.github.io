---
title: Overview
description: The product boundary, development model, and reading path for Unicity AOS.
part: Orientation
order: 0
---

Unicity AOS is the product and distribution developers build, compose, operate, and support. Astrid Runtime is the neutral engine beneath it.

This guide is organized as a manual: read it from start to finish for a first contribution, or use the chapter sidebar as a reference while you work.

It covers the public Community Edition source and the contracts shared with the
private Enterprise composition. Commands and routes marked release-coupled are
part of the `2026.1.0` launch contract but are not presented as published until
matching signed artifacts exist.

## What belongs here

The AOS CLI, Community Edition composition, first-party capsules, product HTTP API, migrations, releases, host integrations, and support workflows.

## What stays with Astrid Runtime

The kernel, daemon, generic SDK, WIT contracts, sandbox, and runtime operator protocol. AOS preserves their published identifiers where compatibility requires it; it does not fork them.

## Reading path

1. **Orientation** explains the repository, state boundary, and product/runtime
   split.
2. **Build capsules** takes one component from Rust package through manifest,
   WIT, IPC, state, tests, and CE composition.
3. **Ship and release** covers installable artifacts, signing, CI, and coupled
   product archives.
4. **Operate AOS** documents the product CLI and safe runtime-state migration.
5. **HTTP API** maps every public and bearer-gated route, including SSE and
   administrative contracts.
6. **Integrate** covers coding hosts and the separate Unicity Audit product.

## Rules that apply everywhere

- Capability checks are enforcement; prompt instructions are not.
- Caller identity comes from the runtime-stamped invocation or authenticated
  HTTP session, never an untrusted payload field.
- Published runtime identifiers remain stable.
- Product releases pin immutable runtime, capsule, and WIT inputs.
- A first-party capsule is still untrusted at the kernel boundary.
- A source repository is not a registry release, and a staged command is not a
  published installer.
