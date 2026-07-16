---
title: Manifest and capabilities
description: Declare package identity, components, authority, environment, publications, and subscriptions safely.
part: Build capsules
order: 45
---

`Capsule.toml` is untrusted input read by the runtime. It is also the reviewable
statement of everything the component intends to do. Keep it explicit and keep
the code within it.

## Package identity

`[package]` supplies the stable name, release version, description, authors, and
runtime compatibility range. A capsule release is immutable: changing code or
manifest data requires a new version and a newly signed artifact.

```toml
[package]
name = "astrid-capsule-example"
version = "0.1.0"
description = "Example AOS capability"
license = "MIT OR Apache-2.0"
astrid-version = ">=0.9.4"
```

## Components

Each `[[component]]` maps an ID to one WebAssembly component file. Capabilities
on the component are an upper bound, not an automatic grant.

```toml
[[component]]
id = "example"
file = "astrid_capsule_example.wasm"
type = "executable"
capabilities = { fs_read = ["cwd://docs/"], fs_write = ["home://.local/share/example/"] }
```

Use the narrowest scheme and prefix. `cwd://docs/` is better than `cwd://`; a
specific API origin is better than arbitrary network access. Never request a
secret merely so the model can see it. Let the host or a provider capsule use
the secret at the edge.

## Environment

`[env]` declares typed configuration fields and onboarding prompts. Environment
values are configuration overlays scoped to the active principal; they are not
a global cache.

```toml
[env]
collection = { type = "string", request = "Collection name", default = "inbox" }
```

Read the value during each invocation when principal-specific overlays can
change. Do not cache it in a process-global static.

## IPC ACLs

`[subscribe]` grants receive intent and binds a topic to an exported handler.
`[publish]` grants send intent. Both are required where a request produces a
response.

```toml
[subscribe]
"example.v1.request.run" = { wit = "@example/contracts/run-request", handler = "handle_run" }

[publish]
"example.v1.response.run" = { wit = "@example/contracts/run-response" }
```

Review topic wildcards as authority. A trailing `*` covers a subtree; it should
not become the default when a finite list is possible.

## Operator-only data

Fields that select privileged host behavior must not be populated from capsule
input or ordinary deserialization. Keep operator configuration in an isolated
parser and mark fields that must never cross the capsule boundary. The manifest
cannot grant itself a principal, rewrite key custody, select arbitrary sockets,
or choose an IPC caller identity.

## Review checklist

- Every imported host operation has a corresponding narrow capability.
- Every published topic is declared.
- Every subscription names the actual exported handler.
- Environment fields state type, purpose, and safe default.
- Secrets are referenced, never printed or copied into prompts.
- Package and WIT identifiers match the released compatibility surface.
- The runtime version range matches the host ABI the component imports.
