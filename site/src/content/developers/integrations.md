---
title: Host integrations and Unicity Audit
description: Connect coding hosts and the blockchain audit product safely.
part: Integrate
order: 160
---

Host adapters for Claude Code, Grok Build, and Codex are maintained as AOS
product integrations. They connect an existing agent interface to the AOS
distribution; they do not replace the runtime or run host-specific business
logic inside its kernel.

## Integration responsibilities

An adapter may:

- detect the local AOS installation;
- start or connect to the supported product service;
- map the host's authenticated session to the intended runtime principal;
- translate host tool and lifecycle events into published contracts;
- render approvals, elicitations, streaming output, and errors;
- explain exactly which files or host configuration it will modify.

An adapter must not:

- expose raw runtime keys or bearer tokens to the model;
- offer arbitrary IPC topic publication;
- let a request body select another principal;
- silently install a standalone Astrid runtime as though it were AOS;
- persist provider keys outside the approved secret store;
- add host policy to the kernel.

## Installation boundary

The AOS product installer may detect supported hosts and ask before wiring them.
A host plugin by itself is not the base product. Documentation must direct users
to the matching signed AOS release before offering plugin-only commands.

The host plugin identity is `aos@aos-oracles` in the `unicity-aos/oracles`
marketplace. The staged host commands are:

```sh
claude plugin marketplace add unicity-aos/oracles && claude plugin install aos@aos-oracles
grok plugin marketplace add unicity-aos/oracles && grok plugin install aos@aos-oracles --trust
codex plugin marketplace add unicity-aos/oracles && codex plugin add aos@aos-oracles
```

These commands remain disabled until the matching AOS product release is
available. A published source repository or an older Astrid plugin identity must
not open the AOS integration path early.

## Runtime access

AOS uses the authenticated control surface and runtime keys of the Astrid engine
it ships. Host adapters go through the AOS HTTP or MCP surface and a named
principal; they do not open the runtime socket, choose another caller identity,
or handle root credentials themselves.

Keep local secrets in the product/runtime home with restrictive permissions.
Never forward them through web pages or browser-visible configuration.

## Unicity Audit

Unicity Audit is the durable audit product backed by the Unicity blockchain.
Astrid Runtime also produces runtime-local audit records for enforcement and
diagnostics. They are related inputs, not the same product.

An AOS integration should define:

1. which runtime record types are eligible for anchoring;
2. canonical serialization and digest rules;
3. batching, ordering, and retry behavior;
4. privacy filtering before any blockchain submission;
5. the Unicity transaction or proof returned to the customer;
6. reconciliation when the local record exists but anchoring is delayed;
7. verification that does not require trusting the AOS service.

Never describe every local runtime event as permanently on the Unicity
blockchain unless that exact anchoring contract has executed and can be proven.

## Build a new host adapter

Start from the product HTTP/OpenAPI surface. Use bearer pairing for a new device,
SSE for live turns and requests, and the approval/elicitation response routes.
Add a dedicated compatibility test against the AOS release matrix and document
all host-owned files. If the adapter requires a missing generic runtime contract,
design that contract upstream rather than using an undocumented socket message.
