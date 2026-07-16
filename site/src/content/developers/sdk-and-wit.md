---
title: SDK and WIT contracts
description: Use the Rust SDK and canonical WIT packages without leaking product policy into the runtime.
part: Build capsules
order: 40
---

The Rust SDK is a safe façade over the `astrid:*` host imports. WIT packages are
the language-neutral ABI. A capsule should depend on the SDK for ordinary host
calls and refer to published WIT identities in its manifest.

## What the SDK exposes

Common modules include:

| Module | Purpose |
| --- | --- |
| `ipc` | publish, subscribe, and request/response over the event bus |
| `fs` | virtual-filesystem access through declared path capabilities |
| `kv` | namespaced runtime storage |
| `http` and `net` | outbound network operations through host policy |
| `process` | constrained process execution where the distribution allows it |
| `identity` | runtime-stamped caller and principal context |
| `elicit` | request structured user input |
| `hook` and `interceptors` | participate in declared product extension points |
| `log` | structured capsule diagnostics |

Import the prelude for macros and common types, then name specialized modules
where the operation should be obvious in review.

```rust
use astrid_sdk::prelude::*;

fn load_settings() -> Result<String, SysError> {
    fs::read_to_string("home://.config/settings.toml")
}
```

That call succeeds only if the component manifest requests the matching
filesystem scope and the operator grants it. The SDK call is not authority.

## Contract evolution

A WIT change affects every language SDK, generated binding, capsule, and host.
Use an existing contract whenever it describes the operation. If a new generic
contract is necessary:

1. Propose the contract in the Astrid Runtime WIT repository.
2. Define request, response, and error types without AOS product policy.
3. Version it according to compatibility impact.
4. Update the Rust SDK mirror and generated bindings together.
5. Release the contract before consuming it from AOS.

Do not rename published `astrid:*` namespaces or `@unicity-astrid` WIT package
identities as branding cleanup. Those strings are ABI and provenance.

## Error design

Return typed domain errors at your capsule boundary. Convert host failures into
the smallest useful public shape, and do not reveal secret values, raw tokens,
or host paths in error text.

Distinguish:

- invalid caller input;
- denied capability;
- unavailable dependency capsule;
- retryable provider or network failure;
- internal invariant failure.

That distinction lets the uplink decide whether to correct input, request
approval, retry, or stop.

## SDK release checks

When updating the SDK itself, run the complete workspace and WIT mirror gates:

```sh
cargo check --workspace
cargo test --workspace
scripts/sync-contracts-wit.sh --check
```

First-party capsules consume published SDK releases. Do not merge temporary path
dependencies into AOS; they bypass the same dependency graph downstream authors
will actually build.
