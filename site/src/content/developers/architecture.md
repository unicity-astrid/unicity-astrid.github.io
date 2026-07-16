---
title: Product and runtime architecture
description: Understand the boundary between the AOS distribution, Astrid Runtime, and capsules before changing code.
part: Orientation
order: 20
---

Unicity AOS is a distribution and product built on Astrid Runtime. The distinction
is operational, not cosmetic: it determines who owns releases, state, commands,
HTTP contracts, compatibility, and support.

## The stack

| Surface | Owner | Examples |
| --- | --- | --- |
| Product | Unicity AOS | `aos`, installers, editions, updates, customer HTTP edge, host integrations |
| Distribution | AOS CE or Enterprise | `Distro.toml`, selected capsules, defaults, onboarding, product policy |
| Components | AOS capsule workspace | model providers, ReAct loop, memory, tools, uplinks |
| Engine | Astrid Runtime | kernel, daemon, sandbox, IPC, capability store, generic gateway |
| Contracts | Astrid Runtime project | `astrid:*` WIT packages, SDKs, capsule artifact format |

The kernel deliberately contains no agent loop, model choice, memory strategy,
or product workflow. It routes typed events, checks capabilities, runs WebAssembly
components, meters resources, and maintains runtime records. Intelligence lives
in capsules.

## How a turn moves

1. An uplink publishes a user prompt on the event bus.
2. The coordinator loads the session and asks the prompt builder for context.
3. Hook capsules contribute identity, project rules, memory, and other context.
4. A provider capsule calls the selected model.
5. Tool calls pass through the router and capability checks.
6. Results return over typed topics and the uplink renders the response.

Every step crosses an explicit contract. Capsules do not call one another by
linking Rust libraries together, and a prompt cannot grant a host capability.

## Decide where a change belongs

Put a change in AOS when it defines the product composition, customer behavior,
edition policy, a first-party capsule, an integration, or a product API. Put it
in Astrid Runtime when every distribution needs the same generic primitive: a
WIT contract, sandbox rule, capability type, scheduler behavior, or daemon API.

If an AOS capsule needs a missing host function, design the smallest generic
contract upstream. Release the WIT and SDK change, then consume that release in
AOS. Do not fork the engine or add an AOS-only escape hatch to the kernel.

## Compatibility is part of the architecture

Published crate names, `astrid:*` WIT namespaces, `@unicity-astrid` package
identities, ABI names, signed artifacts, and release URLs retain their existing
identifiers. Product UI and documentation say Unicity AOS; compatibility surfaces
say Astrid where that is their actual name.

That rule lets AOS evolve its brand and product without breaking verification or
downstream consumers of the runtime.
