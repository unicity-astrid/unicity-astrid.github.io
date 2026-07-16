---
title: Test and debug capsules
description: Separate host logic from component bindings, test failure paths, and diagnose runtime behavior safely.
part: Build capsules
order: 60
---

A good capsule test suite proves domain behavior without requiring a WebAssembly
host for every assertion, then adds packaging and runtime smoke tests at the
boundary.

## Test pyramid

1. **Pure unit tests** validate parsers, reducers, merge rules, path validation,
   and request/response mapping on the host target.
2. **Component build tests** prove `wasm32-unknown-unknown` compilation and
   generated bindings.
3. **Artifact tests** build the installable `.capsule` and inspect its manifest.
4. **Runtime smoke tests** install it into a temporary AOS home, invoke a real
   topic, and assert the response and denial paths.

Keep the macro export thin:

```rust
fn greeting(name: &str) -> Result<String, &'static str> {
    let name = name.trim();
    if name.is_empty() { return Err("name is empty"); }
    if name.len() > 80 { return Err("name is too long"); }
    Ok(format!("Hello, {name}"))
}

#[cfg(test)]
mod tests {
    use super::greeting;

    #[test]
    fn rejects_blank_name() {
        assert_eq!(greeting("   "), Err("name is empty"));
    }
}
```

## Required negative tests

Test more than success:

- malformed and oversized payloads;
- a caller without the requested capability;
- a path outside the declared VFS scope;
- unavailable dependency capsule;
- duplicate and timed-out responses;
- invalid UTF-8 or external provider data;
- retry after a partial operation;
- principal A unable to read principal B's state.

A security fix needs a regression test that fails without the fix whenever the
behavior can be isolated.

## Local commands

Inside a capsule directory, plain `cargo build` uses its checked-in target
configuration. Do not pass a conflicting `--target`.

```sh
cargo fmt -- --check
cargo build
cd ../..
cargo test --locked -p astrid-capsule-example
cargo clippy --locked -p astrid-capsule-example --all-targets --all-features -- -D warnings
```

The plain build runs from the capsule directory and uses its checked-in
WebAssembly target. Host tests and all-target Clippy run from the AOS root so
the nested target configuration does not try to execute a WebAssembly test
binary. Also run `cargo check --locked --workspace` after changing shared
dependencies or SDK-facing code.

## Runtime diagnostics

Use structured logs with capsule name, topic, and correlation ID. Redact secrets,
tokens, prompt bodies, and raw user data. A denied operation is often expected
policy behavior; log it at a level that does not turn ordinary denial into an
incident.

When a capsule does not start, check in order:

1. artifact and manifest hashes;
2. runtime compatibility range;
3. WIT import availability;
4. declared capabilities and environment fields;
5. subscription handler/export names;
6. product distro lock and active principal.

Do not debug by broadening capabilities. Prove the missing edge, update the
manifest narrowly, and retain a denial test.
