---
title: State, files, and secrets
description: Store capsule data in the correct namespace and keep credentials out of model-visible paths.
part: Build capsules
order: 55
---

Choose storage by lifecycle and authority. Product state, runtime state, project
files, and secrets are different domains even when they live on one machine.

## Storage choices

| Need | Surface | Rule |
| --- | --- | --- |
| Small capsule records | namespaced KV | key by domain ID and principal context |
| User-owned capsule files | `home://` VFS | request the narrowest path prefix |
| Current project files | `cwd://` VFS | treat all file content as untrusted input |
| Packaged read-only assets | capsule asset API | version assets with the capsule |
| Credentials | host secret store | use indirectly; never render into prompts or logs |
| Runtime configuration | typed environment overlay | read per invocation when principal-scoped |

The VFS scheme is part of the security boundary. Do not turn a virtual path into
a host path, follow arbitrary symlinks, or accept an unrestricted path from a
model-generated tool call.

## Principal isolation

An installation can serve multiple principals. Configuration overlays, usage,
sessions, and credentials may differ per principal even when capsule code and
WebAssembly instances are shared. Derive state access from the runtime-stamped
invocation context, not a cached environment variable.

Use a stable, validated domain ID as the record key:

```rust
fn session_key(id: &str) -> Result<String, SysError> {
    if id.is_empty() || id.len() > 128 || id.chars().any(char::is_control) {
        return Err(SysError::ApiError("invalid session id".into()));
    }
    Ok(format!("session/{id}"))
}
```

## Secrets

A secret should reach the smallest component that can use it. A provider capsule
may attach an API key to an outbound request; the coordinator and model do not
need the key itself.

Never:

- interpolate credentials into a system prompt;
- publish them on the event bus;
- include them in structured logs or error strings;
- write them into `cwd://` or an exported migration receipt;
- accept a secret value from an unauthenticated product HTTP request.

Expose a configuration field as secret in the distro, then let the runtime
resolve it for the component that owns the operation.

## Schema changes

Version persistent records. A capsule upgrade must be able to distinguish old
and new records, migrate deterministically, and stop safely when it cannot.
Keep migrations idempotent and test both forward conversion and rejection of
unsupported future versions.

For destructive changes, write new state first, validate it, then switch the
pointer. Do not partially rewrite the only copy of a session or identity record.
