# Astrid-in-the-browser — feasibility spike

**Verdict: GO.** A real, unmodified Astrid capsule binary (`prompt-builder`) was
componentized, transpiled with **jco**, instantiated in a JS engine (Node/V8)
with stubbed `astrid:*` host imports, and driven through a real interaction — its
`handle_assemble` interceptor entrypoint — where it executed genuine guest
business logic and produced observable host-side behaviour (bus publishes, KV
writes, an assembled response). Zero `wasi:*` shims were required.

---

## Environment

| Tool | Version |
|------|---------|
| Node | v20.19.6 (V8) |
| npm | 10.8.2 |
| jco | `@bytecodealliance/jco` **1.24.6** (local devDependency) |
| wasm-tools | 1.250.0 |
| cargo | 1.94.1 |
| capsule | `astrid-capsule-prompt-builder` 0.1.0 (astrid-sdk 0.7.1) |

Note: there is no `timeout(1)`/`gtimeout` on this macOS box; commands were bounded
by the harness tool timeout. No stale `astrid-daemon` processes were present.

---

## Reproduce, start to finish

```bash
# 0. from the workspace root
cd /Users/joshuaj.bouw/dev/astrid.worktrees/agent2

# 1. Build the capsule (its own .cargo/config.toml selects wasm32-unknown-unknown;
#    do NOT pass --target). cargo emits a CORE module with an embedded
#    wit-bindgen `component-type` custom section — NOT yet a component.
cd capsules/astrid-capsule-prompt-builder && cargo build --release
cd ../..

# 2. Set up the spike dir
cd astrid-web/spike
export npm_config_cache="$PWD/.npmcache"          # global ~/.npm cache is sandbox-blocked
npm install --save-dev @bytecodealliance/jco

# 3. Copy + componentize.
cp ../../capsules/astrid-capsule-prompt-builder/target/wasm32-unknown-unknown/release/astrid_capsule_prompt_builder.wasm ./prompt-builder.wasm
#    Astrid's astrid-build wraps the core module via
#    `wit_component::ComponentEncoder::default().validate(true).module(bytes).encode()`
#    with NO adapter (zero wasi imports). The wasm-tools CLI equivalent:
wasm-tools component new prompt-builder.wasm -o prompt-builder.component.wasm

# 4. Transpile (async instantiation → explicit imports object we can stub).
npx jco transpile prompt-builder.component.wasm -o transpiled/ --instantiation async

# 5. Drive it in Node — the go/no-go gate.
node run-node.mjs

# 6. Browser page (manual verification):
python3 -m http.server 8099     # run in a NORMAL terminal (sandbox blocks socket bind)
#    then open  http://127.0.0.1:8099/index.html  and click "Run the capsule".
```

### Binary path used
- **Path (a): build from source.** `capsules/astrid-capsule-prompt-builder/target/wasm32-unknown-unknown/release/astrid_capsule_prompt_builder.wasm` (163 KB).
- It is a **core module** (`\0asm 01 00 00 00`), confirmed by `jco transpile` rejecting
  it ("attempted to parse a wasm module with a component parser") and by the header
  bytes. `wasm-tools component wit` *succeeds* on it anyway because it reads the
  embedded `component-type` custom section — that is not proof of a real component.
- After `wasm-tools component new`: `prompt-builder.component.wasm` (component header
  `\0asm 0d 00 01 00`, `wasm-tools validate` clean).

---

## The capsule + its WIT world

Capsule chosen: **prompt-builder** (kept it; see "import surface" below for why the
step-2 fallback to `capsule-memory` was moot).

The component's declared world imports the **entire** Astrid host surface (this is
the fixed `astrid-sdk:capsule` world — every SDK capsule declares all of it,
independent of what it uses):

```
import astrid:io/{error,poll,streams}@1.0.0
import astrid:{fs,ipc,kv,net,http,sys,process,uplink,elicit,approval,identity}/host@1.0.0
import astrid:guest/lifecycle@1.0.0
export astrid-hook-trigger: func(action: string, payload: list<u8>) -> capsule-result
export run: func()
export astrid-install: func()
export astrid-upgrade: func()
```

**Key finding:** the step-2 decision rule ("fall back to memory if imports include
heavyweight host interfaces") does not discriminate between capsules here — the WIT
world is SDK-fixed and identical for every capsule, so memory would import the same
surface. Falling back gains nothing; prompt-builder was retained.

**But the surface that actually matters is far smaller.** `ComponentEncoder` /
jco tree-shake the world down to the imports the core module *actually references*.
The transpiled output demands only **three** interfaces:

| Interface | Functions the guest calls |
|-----------|---------------------------|
| `astrid:ipc/host` | `publish`, `subscribe`, resource `Subscription` (`recv`) |
| `astrid:kv/host` | `kvGet`, `kvSet`, `kvDelete` |
| `astrid:sys/host` | `log`, `getConfig`, `clockMonotonicNs`, `randomBytes`, `checkCapsuleCapability` |

`astrid:guest/lifecycle` is a type-only interface (the `capsule-result` record); no
runtime functions. `fs/net/http/process/uplink/elicit/approval/identity` were
dropped entirely — never imported at runtime.

---

## jco transpile

```
npx jco transpile prompt-builder.component.wasm -o transpiled/ --instantiation async
```

Generated: `prompt-builder.component.js` (207 KB, self-contained ESM — the only
top-level statement is `export function instantiate(...)`, no node/bare imports),
three core wasm modules (`*.core.wasm`, `*.core2.wasm`, `*.core3.wasm`), and `.d.ts`
type maps.

- **No `wasi:*` / `@bytecodealliance/preview2-shim` references** anywhere in the
  output (grep-verified). The capsule truly rides only the `astrid:*` surface.
- **No JSPI / asyncify needed.** Every host function in the used surface is a
  *synchronous* WIT function (including `Subscription.recv`, which takes a
  `timeout-ms` and blocks host-side, not guest-async). `--instantiation async` only
  makes the `instantiate()` factory async (for `WebAssembly.compile`); the host
  import calls are plain synchronous JS.
- The runtime destructures imports by **unversioned** key
  (`imports['astrid:ipc/host']`), while the `.d.ts` `ImportObject` lists **versioned**
  keys (`'astrid:ipc/host@1.0.0'`). The stubs provide both to be safe.

---

## What was stubbed (`host-stubs.mjs`)

A `createHost()` factory returns an `imports` object + an in-memory call `journal`.
Type shapes match the jco-generated signatures exactly:

- `option<T>` → `undefined` for none (`kvGet`, `getConfig` return `undefined`).
- `result<T, error-code>` → return `T` on ok, `throw` on err (never thrown here).
- `u64` → `BigInt` (`clockMonotonicNs`, `recv`'s `timeoutMs`, envelope `dropped`/`lagged`).
- `list<u8>` → `Uint8Array`.
- **Resource** `Subscription` → a JS class; `subscribe()` returns `new Subscription()`;
  `.recv(timeoutMs)` returns an **empty envelope** `{ messages: [], dropped: 0n, lagged: 0n }`.
  Empty-envelope-on-recv is exactly how the real Astrid host signals timeout/no-messages
  (documented invariant), so the capsule's two nested `recv` loops break on the first
  poll instead of blocking.
- `randomBytes(n)` returns `n` real random bytes (the guest's `HashMap`/`HashSet`
  seeding routes through it via the getrandom custom backend).
- `log` / `publish` / `kvSet` etc. record to the journal and console.

---

## Node output transcript (the gate)

```
[2] driving astridHookTrigger('handle_assemble', <payload>)…
    payload: {"system_prompt":"You are Astrid, a secure agent runtime assistant.",
              "request_id":"spike-req-0001","model":"claude-opus-4",
              "provider":"anthropic","messages":[{"role":"user","content":"What can you do?"}]}
  [host] sys#getConfig("hook_timeout_ms") -> none         (x3 config reads)
  [host] ipc#subscribe("prompt_builder.v1.hook_response.spike-req-0001")
  [host] ipc#publish("prompt_builder.v1.hook.before_build", …)     <- hook fan-out
  [host] ipc#Subscription.recv(…, 250n) -> empty-envelope
  [host] sys#log(info, "Collected 0 hook responses for request spike-req-0001")
  [host] kv#kvGet("__tool_schema_cache") -> none
  [host] ipc#subscribe("tool.v1.response.describe.*")
  [host] ipc#publish("tool.v1.request.describe", "{}")             <- tool-describe fan-out
  [host] ipc#Subscription.recv(…, 1999n) -> empty-envelope
  [host] sys#log(info, "Collected 0 tool schemas via tool.v1.request.describe fan-out")
  [host] kv#kvSet("__tool_schema_cache", <2B: "[]">)
  [host] ipc#publish("prompt_builder.v1.response.assemble", …)     <- ASSEMBLED RESULT
  [host] ipc#publish("prompt_builder.v1.hook.after_build", …)

[3] CapsuleResult: {"action":"continue"}

[5] GUEST OUTPUT — published prompt_builder.v1.response.assemble:
{
  "system_prompt": "You are Astrid, a secure agent runtime assistant.",
  "user_context_prefix": "",
  "request_id": "spike-req-0001"
}

[6] VERDICT: PASS — guest code ran and produced observable behaviour
```

15 host calls, correct control flow, the capsule's own `assemble()` logic ran end
to end and echoed `request_id` back on the response bus topic. This is real guest
execution, not a smoke test.

---

## Browser page

`index.html` + inline ESM loads the *same* `transpiled/` component and
`host-stubs.mjs` (the stubs are engine-agnostic; `clockMonotonicNs` falls back to
`performance.now()` off-Node), instantiates via a `fetch`-based `getCoreModule`, and
renders the journal + assembled response on the page.

Run it (from a **normal terminal**, not the sandbox — the sandbox blocks TCP bind):

```
cd astrid-web/spike && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html and click "Run the capsule"
```

Verified served: `index.html`, `host-stubs.mjs`, `transpiled/*.js`, and the core
wasm (`200 application/wasm`). Automated browser verification was intentionally not
attempted (no browser/playwright); the page is for manual confirmation.

---

## Blockers / risks for a full browser host

1. **Componentization is a required build step, not free.** `cargo build` emits a
   core module; the host (or the browser toolchain) must run
   `wasm-tools component new` / `ComponentEncoder` before jco can touch it. A browser
   host would ship *pre-componentized* `.wasm` (the kernel already does this at
   install time), so this is a packaging concern, not a runtime one.
2. **Component-encoding version coupling.** wasm-tools 1.250 / jco 1.24.6 agreed
   here. jco is pinned to a specific component-model encoding; if the kernel's
   `wit_component` (wasmtime side) and jco's decoder drift across a spec bump, a
   valid-for-wasmtime component could fail jco decode. Pin both, test on bump.
3. **Sync host model is a gift — keep it.** Every used `astrid:*` fn is synchronous,
   so no JSPI/asyncify and no `--experimental-wasm-jspi` flag. If future host
   interfaces (e.g. real async `http`/`net` streaming) are exercised by a capsule,
   the browser host must either provide sync-shaped shims or move to jco's async
   ABI + JSPI. The *timeout-blocking* `recv` works today only because the stub
   returns immediately; a real browser host must resolve `recv` without blocking the
   main thread (Atomics.wait in a worker, or an async ABI).
4. **Resources need real lifecycle.** Only `Subscription` surfaced here (trivial).
   A capsule using `fs`/`net`/`http`/`process` resources would need those classes
   implemented with correct handle/`Drop` semantics; jco manages the handle table
   but the host owns the backing behaviour.
5. **Full host surface is large.** The complete `astrid:*` ABI is ~14 interfaces
   with rich resources (net sockets, process spawn, http streams). A production
   browser host is a substantial shim — but capsules only pull the slice they use
   (this one: 3 interfaces), so the surface is per-capsule, and a capability-scoped
   browser host can grow incrementally.
6. **Size:** 207 KB JS + ~135 KB wasm for one small capsule; acceptable, watch total
   payload when hosting many capsules.

---

## Files

- `prompt-builder.wasm` — core module (cargo output, copied).
- `prompt-builder.component.wasm` — componentized (input to jco).
- `transpiled/` — jco output.
- `host-stubs.mjs` — `astrid:*` host stubs + call journal (Node + browser).
- `run-node.mjs` — the go/no-go gate driver.
- `index.html` — browser manual-verification page.
