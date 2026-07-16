---
title: Sign and publish
description: Release immutable capsule artifacts with provenance, signatures, and a safe registry record.
part: Ship and release
order: 75
---

Publishing turns a local component into a supply-chain input. The artifact,
manifest, source commit, signature, and registry metadata must all describe the
same bytes.

## Release inputs

Prepare:

- a clean, reviewed source commit;
- an updated changelog entry;
- the committed dependency lock;
- the installable `.capsule` artifact;
- SHA-256 or stronger content digests;
- the project-approved signing identity and transparency record;
- compatibility metadata for Astrid Runtime and WIT packages.

The signing key does not belong in a developer shell history, repository secret,
or build log. Use the release workflow's protected identity and short-lived
credentials.

## Immutability

Never replace bytes behind an existing capsule version. If metadata, manifest,
or WebAssembly changes, publish a new version. Yank a bad version when the
registry supports it, but retain its provenance record so existing receipts can
still be verified.

## Registry publication

The AOS registry service is not live yet. Until it ships, source availability in
the AOS CE monorepo is not the same thing as a supported one-command registry
install. Product documentation must keep that distinction visible.

When publication becomes available, the registry entry should include:

| Field | Purpose |
| --- | --- |
| package and version | stable lookup identity |
| artifact digest | byte-level verification |
| source repository and commit | provenance |
| publisher identity | accountability |
| signature and transparency proof | tamper evidence |
| runtime and WIT ranges | compatibility resolution |
| license | redistribution terms |

## Distribution composition

After artifacts are published, update the Community Edition `Distro.toml` and
its resolved lock deliberately. A product release points at immutable versions
and digests, not `main`. Verify the complete distro in a clean product home before
tagging AOS.

Enterprise may add private components, but it consumes the same open runtime and
must not rewrite public capsule provenance.
