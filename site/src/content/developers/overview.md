---
title: Overview
description: How Unicity AOS works and where to begin building capsules, integrations, and product features.
part: Orientation
order: 0
---

Unicity AOS is an operating system for AI agents. It gives an agent a place to
run, a set of abilities, and a security boundary around what those abilities can
do. Developers compose the system from capsules instead of baking models, tools,
memory, and guardrails into one privileged process.

The agent can use the same model to extend itself. When it reaches a goal that
requires a missing ability, it can design a capsule, declare the access that
capsule needs, build it, and request live installation. The operator approves
the capability boundary before the new ability runs. The agent decides what it
needs to build from the goal; the user does not have to begin with a capsule idea.

This guide is organized as a manual: read it from start to finish for a first contribution, or use the chapter sidebar as a reference while you work.

It covers Community Edition, capsule development, the AOS CLI and HTTP API,
host integrations, testing, and releases.

## The engine underneath

Astrid is the secure engine inside Unicity AOS. It starts isolated WebAssembly
capsules, routes messages between them, checks signed capability grants, protects
runtime keys, and records local enforcement decisions. It deliberately contains
no agent personality or product workflow.

Unicity AOS supplies the system people use: the `aos` command, Community Edition
composition, first-party capsules, product HTTP API, installer, updates, and host
integrations. Every AOS release includes one exact, tested Astrid release. You do
not install or operate the two as separate halves of the product.

The practical model is simple:

```text
Unicity AOS     the agent operating system you install and use
  └─ Astrid     the secure engine that runs and governs capsules
      └─ capsule  one isolated ability with explicit permissions
```

## Reading path

1. **Orientation** explains the workspace, architecture, and development loop.
2. **Build capsules** takes one component from Rust package through manifest,
   WIT, IPC, state, tests, and CE composition.
3. **Ship and release** covers installable artifacts, signing, CI, and coupled
   product archives.
4. **Operate AOS** documents the product CLI, state, updates, and recovery.
5. **HTTP API** maps every public and bearer-gated route, including SSE and
   administrative contracts.
6. **Integrate** covers coding hosts and the separate Unicity Audit product.

## Rules that apply everywhere

- Capability checks are enforcement; prompt instructions are not.
- Caller identity comes from the runtime-stamped invocation or authenticated
  HTTP session, never an untrusted payload field.
- Treat WIT interfaces and IPC topics as versioned compatibility contracts.
- Product releases pin immutable runtime, capsule, and WIT inputs.
- A first-party capsule is still untrusted at the kernel boundary.
- Source code is not an installable capsule; build, validate, and package the
  signed component before publishing it.
