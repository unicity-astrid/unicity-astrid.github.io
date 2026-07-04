# v2 roadmap designs — the four off-tab tracks

Status: designs settled enough to delegate; none built. Each section ends with
the first concrete step.

## 1. Browser-compilable SDK (playground authoring beyond JS)

Problem: the playground authors capsules in JS (worker + mediated bridge).
Real capsules are wasm components. Rust cannot compile in a tab.

Options weighed:
- **AssemblyScript**: the compiler is TypeScript and runs in-browser; output
  is a core wasm module. wit-bindgen has NO AssemblyScript generator, so the
  `astrid:guest` world bindings (canonical ABI lifting/lowering for strings,
  list<u8>, records, one resource) would be hand-written. Our surface is
  small (ipc/kv/sys), so this is bounded but real work, and it drifts unless
  pinned to the WIT by a conformance test against the Rust capsules.
- **Hosted build service** (see track 2): the site becomes an uplink to a
  daemon that runs `astrid capsule build` server-side on submitted Rust.
  Full fidelity, zero new SDK, but requires infrastructure and quota design.
- Rejected: TinyGo/Porffor/QuickJS routes (no in-browser compiler, or not a
  compiler at all).

Decision: hosted build service is the primary path to "write a REAL capsule
from the site"; AssemblyScript stays an exploratory candidate whose first
gate is a hand-written binding for `astrid:sys/log` + `astrid:ipc/publish`
only, validated against the same smoke harness the site capsules use.

First step: none until track 2 lands or is rejected; AS spike is opportunistic.

## 2. Uplink a local Astrid daemon to the playground

Goal: visitor runs Astrid locally, clicks "connect your Astrid" on the site,
and the playground shows THEIR principals/capsules and publishes into THEIR
bus (with consent).

Transport reality: an https page may fetch `http://127.0.0.1:<port>` —
loopback is a potentially-trustworthy origin, so this is not mixed content in
Chromium; Private Network Access adds a preflight the gateway must answer.
Safari/Firefox vary, so feature-detect and degrade to copy-paste pairing.

Design:
- Gateway grows explicit browser support: CORS allowlist for the site origin
  + PNA preflight headers (`Access-Control-Allow-Private-Network: true`),
  both OFF by default and enabled by a config key the pairing flow sets.
- Pairing: `astrid pair --browser` prints a one-time code; the site exchanges
  it for a device-scoped pair token (per-device capability scope work,
  core #947/#999) held in localStorage. Token is read-mostly: principal list,
  capsule list, bus tail. Anything mutating goes through the daemon's own
  consent gates (ingress consent).
- Playground UI: "connect your Astrid" panel; when connected, the rig can
  target `your daemon` instead of `in-tab kernel` — same components, real
  provenance labels.

First step: RFC-check whether gateway CORS/PNA needs an RFC (it is HTTP
surface, not WIT; likely just a core issue), then core issue + gateway PR.

## 3. Capsule registry on GitHub Pages

Yes, it can be static. Design:
- Repo `unicity-astrid/registry`. GH Pages serves a **sparse index**:
  `index.json` (registry metadata + capsule list) and
  `c/<name>.json` per capsule: versions, sha256, ed25519 publisher signature,
  publisher key id, and a download URL pointing at a GitHub **Releases**
  asset (the `.capsule` blob). Pages never hosts blobs; Releases does.
- Trust is the signature chain, not the host: clients verify publisher
  signature + hash after download; the blessed distro trust root
  (claude-distro model) decides which publisher keys are trusted. A
  compromised Pages deploy can at worst serve stale/denied listings, never
  valid-but-malicious capsules.
- Publishing = PR to the registry repo; CI validates schema, hash, and
  signature before merge. Growth is git history; mirrors are `git clone`.
- Site integration: the registry section of the site fetches `index.json`
  client-side and renders the live catalog.

First step: define `index.json` / `c/<name>.json` schema in an RFC-adjacent
doc (schema only, no WIT change), then Joshua creates the repo.

## 4. Multi-tenant density benchmark

Claim to earn: "a single server could serve thousands of tenants." Site copy
currently says the benchmark is on the roadmap; this is the roadmap.

Harness design (`core` tooling, not site):
- One daemon, fresh ASTRID_HOME, N principals sharing the same capsule set
  (dedup: capsules are content-addressed; per-principal loading is the
  isolation boundary).
- Sweep N in {1, 10, 100, 1000}: measure daemon RSS delta per added tenant,
  steady-state CPU at idle, and event throughput under a fixed per-tenant
  traffic script (publish + tool round-trip).
- Output: tenants-per-GB and events/sec/tenant table, committed with the
  exact commit hash and hardware notes. Site copy flips from "pending" to
  the table.

First step: core issue describing the harness; build as `tools/` script, not
a criterion bench (it measures a process, not a function).
