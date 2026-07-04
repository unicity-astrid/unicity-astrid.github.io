# Kernel-core wasm32 portability audit

Target: `wasm32-unknown-unknown` (browser / wasm-bindgen / Web Worker profile).
Method: `cargo check` only, per-crate, against origin/main @ `051364f`. All experiments
reverted; tree clean at end. `timeout` is absent on macOS — used a perl `alarm`-based
wrapper (`scratchpad/to.sh`) as the `timeout 300` equivalent.

## Part 1 — Portability matrix

| Crate | Classification | Exact blocker(s) |
|-------|----------------|------------------|
| `astrid-types` | PORTS-WITH-GATING | getrandom **0.4.3** via `uuid` (`rng-getrandom` feature). No tokio. Default features already OFF (chrono `clock` gated). Only fix: enable getrandom `wasm_js`. |
| `astrid-core` | PORTS-WITH-GATING **(compile-proven)** | (a) getrandom 0.4.3 via `uuid`+`rand 0.10`; (b) **mio** — its `tokio` is `time,sync` but the **workspace** `[workspace.dependencies] tokio` base pins `net,signal,io-util,rt-multi-thread`, forced onto every `workspace=true` consumer → pulls mio (no wasm net). Trim tokio base to `sync,macros,time,rt`. |
| `astrid-crypto` | PORTS-WITH-GATING **(compile-proven)** | getrandom 0.4.3 via `rand 0.10`. `ed25519-dalek 2.2` + `rand 0.10` **compile and ed25519 signing works** under the `wasm_js` backend. No tokio. |
| `astrid-capabilities` | PORTS-WITH-GATING **(compile-proven)** | getrandom + workspace-tokio mio; depends on `astrid-storage[kv]` → **surrealkv compiles** (see storage caveat). `globset`/`tokio[rt]` port. |
| `astrid-audit` | PORTS-WITH-GATING (inferred) | Same dep shape as capabilities: `astrid-storage[kv]`→surrealkv, crypto, tokio[rt]. Pure chain-link logic on top. |
| `astrid-events` | PORTS-WITH-GATING | getrandom + workspace-tokio mio. `dashmap`/`parking_lot`/`metrics`(facade)/route `TopicMatcher` all port. Its own tokio is `sync,rt`. |
| `astrid-config` | **PORTS-AS-IS (proven)** | None. Compiles clean, default features. `directories 6.0` compiles on wasm (returns `None` for home/config dirs at runtime — a *runtime* concern, not a compile blocker). No tokio, no getrandom. |
| `astrid-storage` (`--features kv`) | PORTS-WITH-GATING to compile / **RUNTIME-NATIVE** | getrandom + workspace-tokio mio; `surrealkv 0.21` **type-checks on wasm** (std::fs compiles) but is disk/file-backed — non-functional in-browser. Needs an OPFS/IndexedDB `KvStore` impl behind the existing trait. |
| `astrid-approval` | PORTS-WITH-GATING (inferred) | Same shape (audit+capabilities+storage[kv] transitive → surrealkv). Pure policy/allowance types. |
| `astrid-vfs` | **NATIVE-ONLY (proven)** | `cap-std 4` → `rustix` → **`errno` hard `compile_error!`** ("target OS unknown"). Also `tokio[fs]`, `tempfile`, `ignore`. Fundamentally OS fs; browser must supply an OPFS-backed `Vfs` impl (trait already exists — the *crate* is native, the *trait* is the seam). |

### Dominant structural blocker (not per-crate)
The workspace-root `[workspace.dependencies] tokio` declares
`features = ["sync","macros","time","rt","rt-multi-thread","net","io-util","signal"]`.
Cargo makes `[workspace.dependencies]` features **additive** with each consumer's own
`features = [...]`, so `net`+`signal` are forced onto every crate that writes
`tokio = { workspace = true, ... }`, even ones asking only for `sync`/`time`. `net` pulls
**mio**, which `compile_error!`s on wasm. This is a one-line-per-profile fix (a wasm build
must not inherit the shared tokio base) but it touches the whole tree, so it reads as a
single decisive edit rather than N per-crate ones.

## Part 2 — getrandom / crypto findings

`Cargo.lock` carries **three** getrandom majors simultaneously:

| Version | Pulled by (wasm tree) | Browser backend requirement |
|---------|----------------------|-----------------------------|
| **0.4.3** | `uuid` (`uuid-rng-internal`), `rand 0.10` | `wasm_js` **feature** + `RUSTFLAGS=--cfg getrandom_backend="wasm_js"` |
| **0.3.4** | transitive (surrealkv side) | same: `wasm_js` feature + `--cfg getrandom_backend="wasm_js"` |
| **0.2.17** | older transitive | different mechanism: `js` **feature**, no cfg needed |

Default-feature wasm builds fail immediately with getrandom 0.4.3's
`"wasm32-unknown-unknown are not supported by default; enable the wasm_js feature"`.
Proven fix: adding `getrandom = { version = "0.4", features = ["wasm_js"] }` to the crate
under test + exporting `RUSTFLAGS='--cfg getrandom_backend="wasm_js"'` makes `astrid-crypto`
(ed25519 + rand), `astrid-core`, and `astrid-capabilities` (incl. surrealkv + getrandom
0.3.4) all compile. **ed25519 signing ports** — `ed25519-dalek 2.2.0` and its `rand_core`
path build cleanly under the browser RNG backend. Note the cfg is global (a `RUSTFLAGS`
value on the whole build), and the feature must be enabled on **each** getrandom major in
the tree (`wasm_js` on 0.3/0.4, `js` on 0.2). The kernel's existing capsule story routes
getrandom through the SDK's custom `astrid:sys.random-bytes` backend; the browser
kernel-core would instead point getrandom at the browser `crypto.getRandomValues` via
`wasm_js` — a different backend, same call sites.

## Part 3 — Kernel-core seam proposal

`astrid-kernel` (17.4k LOC, 8 non-test modules) mixes pure semantics with daemon plumbing.
Crucially, **the pure semantic types it operates on do not live in `astrid-kernel` — they
live in `astrid-capsule`, the Wasmtime crate** (`FuelLedger`, `FuelRateLimiter`,
`MemoryLedger`, `CapsuleRuntimeLimits`, `HttpLimits`, `CapsuleManifest`, `CapsuleId`). That
crate pulls `wasmtime` + `wasmtime-wasi` (native host, not a wasm guest). So the ledgers /
manifest / capsule-id / interceptor topic matcher are **trapped inside the engine crate that
is being replaced**. Extracting a `astrid-kernel-core` means first carving those pure types
out of `astrid-capsule` into a wasm-safe crate (call it `astrid-capsule-types`) that both the
native Wasmtime engine and the browser engine depend on. The route-layer `TopicMatcher`
already lives in `astrid-events` and ports as-is.

Module-by-module for `astrid-kernel`:

**KEEP (pure semantics, port with the gating above):**
- `kernel_router/` — admin IPC dispatch. `resolve_scope` / `required_capability` /
  `kernel_request_method` are pure functions over `KernelRequest` (astrid-core). Capability
  validation, group/quota/token-mint handlers operate on stores via traits.
- `capsules_loaded.rs` — broadcast-payload shaping (pure serde).
- The `Kernel` struct's semantic state: `fuel_ledger`, `fuel_rate`, `memory_ledger`,
  `runtime_limits`, `http_limits`, `active_connections` (`DashMap<PrincipalId,_>`),
  `local_egress`, `profile_cache` — all pure once their types are freed from `astrid-capsule`.
- Token/invite logic in `invite.rs` / `pair_token.rs`: `generate_token`/`hash_token`/
  `ct_hash_eq`/`prune_expired` are pure (crypto + time only).

**REPLACE (daemon plumbing, browser-specific reimpl):**
- `socket.rs` — `UnixListener::bind` + `flock` singleton (`std::fs::File`). Replaced wholesale
  by a `postMessage` port + a tab-level singleton (BroadcastChannel/Web Lock).
- `tokio = { features = ["full","signal"] }` in the kernel — `full` pulls net/process/fs;
  `signal` is Unix. Browser uses `wasm-bindgen-futures` + `sync`/`time` tokio only.
- `bus_monitor.rs` / `grant_on_use.rs` — `tokio::spawn` + `tokio::time::interval` background
  loops; on wasm use `spawn_local` + `gloo`-style timers (tokio `time::interval` needs a
  driving runtime that wasm32-unknown-unknown lacks).

**ABSTRACT (trait boundary, native impl vs browser impl):**
- `UplinkTransport` — over the Unix socket today (`cli_socket_listener`), over `postMessage`
  in-browser. The kernel already treats the listener as an opaque handle handed to the
  execution context, so the seam is natural.
- `Vfs` (Arc<dyn Vfs>, from `astrid-vfs`) — trait exists; native = cap-std, browser = OPFS impl.
- `IdentityStore` / `KvStore` / audit sink (Arc<dyn …>, from `astrid-storage`) — trait exists;
  native = surrealkv-on-disk, browser = IndexedDB/OPFS. `InviteStore`/`PairTokenStore` and the
  `token_path`/`astrid_home` `PathBuf`s must move behind this same store trait (they do raw
  `load`/`save` to disk paths today).
- `Clock` / `Spawner` — abstract `Instant::now`/`tokio::spawn`/interval over
  native-tokio vs `wasm-bindgen-futures`.

## Part 4 — Effort read

**Mechanical feature-gating (low risk):** getrandom `wasm_js` wiring + `RUSTFLAGS` cfg; a
wasm build-profile tokio declaration that doesn't inherit the net/signal base; `astrid-config`
needs nothing; `astrid-types`/`-core`/`-crypto`/`-events` are pure-logic and compile-proven
(or trivially so) once gated.

**Real surgery (medium-high):**
1. Carve the pure capsule types (ledgers, manifest, CapsuleId, limits, interceptor matcher)
   out of the Wasmtime `astrid-capsule` crate into a wasm-safe crate the kernel-core can own.
2. Give `astrid-storage` a real browser backend (IndexedDB/OPFS) behind `KvStore`/
   `IdentityStore` — surrealkv compiles but is non-functional in-browser; and move
   invite/pair-token/token-path persistence behind it.
3. Give `astrid-vfs` an OPFS `Vfs` impl (the crate itself is native-only; only the trait ports).
4. Extract `astrid-kernel-core`: split routing/capability/ledger/manifest semantics from
   `socket.rs`/`bus_monitor`/`grant_on_use`/tokio-full behind `UplinkTransport`/`Clock`/`Spawner`.

**3 riskiest unknowns:**
1. **surrealkv is a compile-passes / runtime-fails trap.** It type-checks on wasm (std::fs
   compiles) so a naive build looks green, then every KV op fails at runtime in-browser. The
   whole capability/audit/approval stack depends on it transitively via `astrid-storage[kv]`;
   the real cost is a from-scratch browser KV backend, not a feature flag. This is the single
   biggest hidden scope.
2. **Pure semantics are welded into the Wasmtime crate.** The ledgers/manifest/capsule-id the
   kernel routes on live in `astrid-capsule` (wasmtime + wasmtime-wasi). Untangling them
   without a churn-heavy refactor of the engine crate (which is simultaneously being replaced)
   is an ordering/coordination hazard.
3. **Async model mismatch.** The kernel's liveness (bus monitor, grant-on-use timeouts,
   keepalive) leans on a multi-threaded tokio runtime with `interval`/`timeout`/broadcast.
   `wasm32-unknown-unknown` has no tokio runtime driver; broadcast channels port but timers
   and `spawn` do not. Reproducing the bus-monitor lag accounting and grant-on-use timeout
   semantics on a single-threaded `spawn_local` + JS-timer model is unproven and easy to get
   subtly wrong (dropped ticks, starvation) — exactly the class of bug the kernel already
   guards against on native.

## Verification
Final `git status --porcelain` (core repo): only `?? CLAUDE.md` (pre-existing untracked).
No tracked modifications. All Cargo.toml experiments reverted; `Cargo.lock` restored.
