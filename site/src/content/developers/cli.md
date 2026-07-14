---
title: Product CLI
description: Use aos for product workflows and understand which operator commands delegate to the bundled runtime.
part: Operate AOS
order: 100
---

`aos` is the product command. It owns the product home, Community Edition
initialization, migration, health projection, version identity, and update
policy. Operator commands that are not product-specific delegate to the Astrid
Runtime bundled in the same AOS release.

## Product-owned commands

| Command | Behavior |
| --- | --- |
| `aos --help` | product help and delegation boundary |
| `aos --version` | AOS calendar-SemVer version, such as `2026.1.0` |
| `aos init` | apply the Unicity CE manifest embedded in this product release |
| `aos status [--json]` | read typed local runtime status without invoking the runtime CLI |
| `aos migrate runtime --from PATH` | copy compatible standalone runtime state deliberately |
| `aos serve-health` | bind the narrow loopback health endpoint |
| `aos self-update` | reject runtime-only updating and direct callers to the product updater |

`aos init` accepts the runtime's supported non-distro onboarding flags:

```sh
aos init --yes
aos init --offline
aos init --var openai_model=gpt-5.4
```

It rejects `--distro` because AOS initialization always composes Unicity CE. A
developer who deliberately wants another distribution uses standalone Astrid
Runtime outside the product installation.

## Delegated commands

Every other command is executed by `~/.unicity-os/runtime/bin/astrid` with
`ASTRID_HOME=~/.unicity-os/runtime` and the product workspace state directory
set only in the child process. This includes runtime/operator surfaces such as
daemon operation, capsule inspection, distro status, diagnostics, and agent
execution.

```sh
aos doctor
aos daemon
aos capsule list
aos run
```

The exact delegated command set is the command set of the Astrid Runtime version
pinned into that AOS release. `aos` does not copy the implementation and should
not maintain a second parser for every runtime flag.

## Product home override

Use `UNICITY_AOS_HOME` to isolate a development or CI installation:

```sh
export UNICITY_AOS_HOME="$(mktemp -d)"
aos init --yes
```

Do not export `ASTRID_HOME` globally as an AOS setup step. The wrapper owns that
child-process setting, which prevents product state from colliding with a
standalone runtime.

## Exit codes and automation

Product commands return zero on success and nonzero on validation, migration,
health-service, or child-runtime failure. Automation should consume the exit
code and structured HTTP contracts rather than matching human help text.

`aos serve-health` binds only `127.0.0.1:8765`. It is a long-running service,
not a one-shot health check; probe it with `GET /v1/runtime/health`.
