---
title: Capsule anatomy
description: Create a first capsule with a manifest, SDK entry point, explicit IPC contract, and host tests.
part: Build capsules
order: 35
---

A capsule is an installable WebAssembly component plus a declarative manifest.
It is not a daemon plugin and it is not a Rust library loaded into the kernel.
The runtime instantiates it inside a sandbox and exposes only the WIT imports and
capabilities approved at installation.

## Create the package

First-party capsules live at `capsules/capsule-<name>` in the AOS CE workspace.
A minimal layout is:

```text
capsules/capsule-greeter/
├── .cargo/config.toml
├── Cargo.toml
├── Capsule.toml
├── README.md
└── src/lib.rs
```

Use the workspace SDK and compile as a `cdylib`.

```toml
[package]
name = "astrid-capsule-greeter"
version = "0.1.0"
edition = "2024"
license = "MIT OR Apache-2.0"

[lib]
crate-type = ["cdylib"]

[dependencies]
astrid-sdk = { workspace = true }
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
```

The published package name can retain the `astrid-capsule-*` compatibility
identity while its description and documentation correctly place it in AOS.

The checked-in target configuration makes a plain capsule build produce the
component input expected by the packaging tool:

```toml
[build]
target = "wasm32-unknown-unknown"

[target.wasm32-unknown-unknown]
rustflags = ["--cfg=getrandom_backend=\"custom\""]
```

That custom random backend routes entropy through the audited `astrid:sys`
host import. Do not switch the capsule to WASI to make an undeclared host call
work.

## Implement one handler

The SDK macros generate the component export surface. Keep the handler small and
move deterministic logic into ordinary Rust functions that host tests can call.

```rust
#![deny(unsafe_code)]

use astrid_sdk::prelude::*;

#[derive(Default)]
pub struct Greeter;

#[capsule]
impl Greeter {
    #[astrid::interceptor("handle_greet")]
    pub fn handle_greet(&self, payload: serde_json::Value) -> Result<(), SysError> {
        let name = payload.get("name").and_then(serde_json::Value::as_str).unwrap_or("agent");
        ipc::publish_json(
            "greeter.v1.response.greet",
            &serde_json::json!({ "message": format!("Hello, {name}") }),
        )
    }
}
```

Never trust a caller identity supplied inside `payload`. The runtime-stamped
envelope is the authority for the current invocation. Validate size, required
fields, enum values, and paths before touching a host import.

## Declare the same contract

`Capsule.toml` is the runtime's installation boundary. The subscribe handler must
match the exported macro name, and every response topic must be allowed by
`[publish]`.

```toml
[package]
name = "astrid-capsule-greeter"
version = "0.1.0"
description = "Greeting example for Unicity AOS"
astrid-version = ">=0.9.4"

[[component]]
id = "greeter"
file = "astrid_capsule_greeter.wasm"
type = "executable"

[subscribe]
"greeter.v1.request.greet" = { wit = "@example/greeter/greet-request", handler = "handle_greet" }

[publish]
"greeter.v1.response.greet" = { wit = "@example/greeter/greet-response" }
```

Only one trailing wildcard is accepted for normal subtree subscriptions. Prefer
concrete publish topics when the capsule can enumerate them. A handler return
value is not a bus response; publish the response explicitly.

## First validation loop

```sh
cd capsules/capsule-greeter
cargo fmt -- --check
cargo build
cd ../..
cargo test --locked -p astrid-capsule-greeter
```

Plain `cargo build` verifies the WebAssembly compilation configured by the
capsule. Run host tests from the workspace root so the member's WebAssembly
target configuration does not try to execute a browserless `.wasm` test binary.
The build does not produce an installable `.capsule`; packaging is a separate
step covered in [Build and package](/developers/build-package/).
