---
title: Migrate an existing runtime
description: Copy standalone runtime state into AOS with schema review, content verification, and a durable receipt.
part: Operate AOS
order: 120
---

Migration is opt-in and copy-based. It never renames, mutates, or deletes the
standalone source installation.

```sh
aos migrate runtime --from /absolute/path/to/legacy/home
```

Stop the source daemon first. The command rejects relative paths, symlinks,
special files, live sockets, unsafe target merges, and attempts to import runtime
binaries.

## What must migrate

Compatible persistent state includes:

| Source area | Examples | Treatment |
| --- | --- | --- |
| `keys/` and `secrets/` | runtime-held identity and credentials | copy without printing contents; preserve restrictive modes |
| `var/` | persistent runtime and capsule records | copy and hash |
| `wit/` | installed contract packages | copy and hash |
| `home/` | principal and capsule files | copy and hash |
| reviewed `etc/` data | profiles, grants, quotas, group policy, gateway and hook configuration | migrate through explicit schema allowlists |

The `etc/` tree is security and identity configuration, not disposable process
state. A migration must not silently omit it. Unknown or unsupported config
should stop the migration with a precise report rather than be guessed.

## What must not migrate

Do not copy sockets, PID files, readiness markers, session tokens, transient
locks, caches, or binaries. AOS supplies its own pinned runtime under
`~/.aos/runtime/bin`.

Legacy distro selection is preserved as historical state but not silently
activated as the product distro. Run `aos init` deliberately to apply Unicity CE
after import.

## Safe cutover

A safe importer:

1. inventories and validates the source without writing the target;
2. copies allowed entries into a private staging directory;
3. records file type, mode, length, and a cryptographic content digest;
4. verifies staged bytes against that inventory;
5. atomically promotes the staged tree;
6. writes and synchronizes a versioned receipt;
7. leaves the source unchanged.

The receipt should identify the source and target, migration schema version,
timestamp, imported categories, per-file digest or a Merkle-equivalent manifest,
and final tree digest. File length alone does not detect same-size corruption.

## Idempotency and recovery

Re-running the same completed migration returns success without duplicating
state. A conflicting source, changed receipt, partial target, or unsupported
schema stops with an error. Do not merge two security configurations implicitly.

If validation fails before promotion, remove only the staging directory. If the
process dies after promotion but before receipt durability, the next run must
recognize and reconcile that state safely rather than overwriting it.

## Verify after import

Before deleting any operator-created backup or decommissioning standalone
Astrid, verify:

- expected principals and device keys exist;
- grants, quotas, and groups match the source;
- capsule data and sessions are readable by the correct principal;
- provider secrets work without appearing in logs;
- the AOS daemon and health service start from the product home;
- the standalone source still starts independently if rollback is required.
