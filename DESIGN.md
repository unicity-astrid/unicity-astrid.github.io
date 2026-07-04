# Astrid Website — Design Spec

Author: session design partner. Status: LOCKED for build phase 1-3. Builders do not
make design decisions; anything ambiguous comes back to the orchestrator.

## 0. The one idea

**The site does not describe Astrid. The site runs Astrid.**

Every marketing site for a runtime says "trust us." This one boots the real kernel
(`astrid-kernel`, compiled to `wasm32-unknown-unknown`, the same crate that ships in
the daemon) in the visitor's tab, and every animated element on the page is driven by
real kernel behaviour: real EventBus deliveries, real CapabilityStore grants and
denials, real BLAKE3 audit entries. A visitor who opens devtools finds a genuine wasm
kernel, not a video.

The story we tell with it is **extensibility**: Astrid is the OS agents extend from
the inside. Security is the floor, not the pitch.

Honesty rule (inherited from DOCS-BLUEPRINT voice): nothing on the page pretends to
be live if it is not. Every live element carries provenance ("real kernel, compiled
from astrid-kernel @ <commit>"). Shipped vs. possible is always stated. **No em-dashes
in site copy.** Zero hedging, lead with insight.

## 1. Repo layout (all under `astrid-web/`, git init here, branch `main`)

```
astrid-web/
  DESIGN.md            this file
  kernel-web/          NEW crate: wasm-bindgen JS API over the real kernel
  kernel-smoke/        existing regression harness (keep as-is, becomes CI gate)
  site/                Astro app
  spike/               existing jco spike (keep; playground raids it in phase 3)
  notes/               existing
```

`.gitignore`: `target/`, `node_modules/`, `dist/`, `pkg/`, `.astro/`, `.npmcache/`.
Conventional commits. No version bumps. Commits GPG-signed.

## 2. Tech stack (decided, do not substitute)

- **Astro 5 + TypeScript strict**, static output. Rationale: content collections
  ingest the mdBook markdown untouched; islands keep the wasm kernel off the
  critical path; deploys anywhere static.
- **No UI framework.** Interactive pieces are Web Components / plain TS modules
  (matches the DOCS-BLUEPRINT decision that widgets are Web Components).
- **GSAP + ScrollTrigger** (npm) for scroll choreography. Canvas 2D for the bus
  scene (no three.js in phase 1; keep the door open).
- **Fonts self-hosted via @fontsource**: Space Grotesk (display/headings),
  Inter (body), IBM Plex Mono (code, HUD, terminals). No external CDNs of any kind.
- **kernel-web** built with `wasm-pack build --target web` (verified working).
  Toolchain 1.95.0, `.cargo/config.toml` rustflags `--cfg getrandom_backend="wasm_js"`,
  getrandom 0.4 AND 0.3 with `wasm_js` feature (copy kernel-smoke's setup exactly).
- Package manager: npm. `npm_config_cache` may need pointing into the repo if the
  global cache is sandbox-blocked (see spike/README.md).

## 3. kernel-web crate (the bridge)

Path deps on `../../core/crates/...` (same set as kernel-smoke). Thin
`#[wasm_bindgen]` surface, all real, no mocks:

```rust
#[wasm_bindgen]
pub struct AstridWeb { /* Arc<Kernel> + handles */ }

#[wasm_bindgen]
impl AstridWeb {
    pub async fn boot() -> Result<AstridWeb, JsError>;      // Kernel::with_resources, in-memory resources (kernel-smoke::boot_in_memory pattern)
    pub fn kernel_commit(&self) -> String;                   // env!-injected git SHA of core checkout
    pub async fn kv_set(&self, ns: &str, key: &str, val: &str) -> Result<(), JsError>;
    pub async fn kv_get(&self, ns: &str, key: &str) -> Result<Option<String>, JsError>;
    pub async fn publish(&self, topic: &str, json: &str) -> Result<(), JsError>;
    pub fn subscribe(&self, pattern: &str, cb: js_sys::Function) -> Result<(), JsError>;
        // spawns (astrid-runtime spawn) a recv loop; each event -> cb(topic, json)
    pub async fn grant(&self, principal: &str, resource: &str, perm: &str) -> Result<String, JsError>;
        // real CapabilityStore add; returns token id
    pub async fn check(&self, principal: &str, resource: &str, perm: &str) -> Result<bool, JsError>;
        // real find_capability
    pub async fn audit_len(&self) -> Result<u64, JsError>;   // real audit chain length
    pub async fn audit_tail(&self, n: u32) -> Result<String, JsError>; // JSON array of last n entries (hash, action)
    pub fn events_routed(&self) -> u64;                      // counter incremented by a wildcard subscription
}
```

If an API above does not map cleanly onto real kernel/audit surfaces, the builder
STOPS and reports; no faking, no stub returns. (Known-good from kernel-smoke: boot,
kv round-trip, publish/subscribe with AstridEvent::Custom. CapabilityStore add/check
is async post-#1153 and injectable. AuditLog::in_memory constructs on wasm.)

## 4. Visual direction

**Theme: "the visible machine."** Deep-space dark. The kernel is a small, quiet,
almost boring core at the centre of the composition, and everything alive and
colourful happens AROUND it in capsule-space. The visual grammar literally teaches
the architecture: dumb kernel, vivid capsules, light travelling on the bus.

Palette (CSS custom properties, exact values are the builder's to tune within this
family, contrast AA minimum):

```
--bg:        #07080D    near-black, slight blue
--surface:   #0D0F17
--line:      #1C2030    hairlines, 1px, everywhere; blueprint feel
--text:      #E8EAF2
--text-dim:  #8A90A6
--kernel:    #B8BECF    the kernel is GREY on purpose; it is dumb
--bus:       #5EEAD4    teal; event trails, live elements
--capsule:   #A78BFA    violet; capsule bodies, extensibility accents
--grant:     #4ADE80    capability granted
--deny:      #F59E0B    capability denied (amber, not red; denial is normal, not error)
--audit:     #F472B6    audit chain accents
```

Typography: Space Grotesk for display at heavy weights and tight leading, huge
hero sizes (clamp to viewport); Inter 16-18px body; Plex Mono for anything the
kernel says. Numbers in HUDs use tabular figures.

Motion principles:
- Everything animated on the marketing path is either (a) driven by a real kernel
  event or (b) pure decoration that never claims to be data.
- 60fps or it ships simpler. `prefers-reduced-motion` honoured everywhere
  (fall back to static states, counters still update, no scroll-jacking).
- Scroll choreography: sections pin briefly while their scene plays; never trap
  the wheel; every scene has a resting completed state.
- Micro-interactions: bus events pulse a 1px ring; grants flash --grant on the
  capability ledger; denials shake 2px and stamp an amber entry.

## 5. Page architecture

### 5.1 `/` — the flagship narrative

Fixed HUD (top-right, Plex Mono, small): `● kernel online · astrid-kernel@<sha> ·
<n> events routed · <n> audit entries`. Live from second one. Before boot resolves:
`○ booting kernel…`. If wasm fails (old browser): `○ kernel offline (static mode)`
and the page degrades gracefully to static scenes. Clicking the HUD opens a drawer
with the real audit tail and a "verify me in devtools" note telling visitors the
wasm module name to look for.

Sections, in order (copy skeleton is binding; body copy may be polished within
DOCS-BLUEPRINT voice):

1. **Hero.** Eyebrow: `ASTRID · A SECURE AGENT RUNTIME`. H1: **"An operating
   system that agents extend."** Sub: "Every ability is a capsule: sandboxed
   WebAssembly, signed capabilities, an audit chain grown byte by byte. Write a
   capsule, install it live, and the OS gains the skill. No forks. No trust
   required." Primary CTA "See it run" (scrolls to scene 2), secondary "Read the
   book". Behind the type: the bus canvas idling; sparse teal particles drifting
   along faint lines toward a small grey core. The hero claim badge under the CTAs:
   "This page is running the real Astrid kernel in your tab."
2. **"The kernel is dumb. That is the point."** Scene: the grey core alone,
   routing pulses between anonymous endpoints. Copy: the kernel routes events,
   enforces capabilities, runs the sandbox, and nothing else; intelligence lives
   in capsules, so replacing intelligence never means forking the OS. A real
   `publish` fires every few seconds from a page-owned demo publisher; each pulse
   the visitor sees increments the real `events_routed` counter in the HUD.
   Caption credits it: "each pulse is a real EventBus delivery."
3. **"Everything else is a capsule."** Scene: capsule tiles (model provider,
   agent loop, tools, memory, frontends) dock around the core one by one on
   scroll; as each docks, a labelled topic path lights (`prompt_builder.v1.*`,
   `tool.v1.*`, real topic names from the book's topic registry). Copy: swap the
   provider, swap the loop, same OS underneath.
4. **"Power that only narrows."** Interactive: three buttons in a mock capsule
   card: `read ~/notes` (granted), `write ~/notes` (granted after a visible grant
   flow), `read ~/.ssh` (DENIED). Each click calls the REAL CapabilityStore via
   kernel-web `grant`/`check`, and the result stamps a real audit entry shown in a
   side ledger with its chain hash. Copy: capabilities are signed tokens, children
   can only get narrower, denial is the default and the audit chain remembers
   everything. This is the security floor stated in one scene, not the whole pitch.
5. **"Agents that grow themselves."** The extensibility crescendo. Scene:
   storyboard of the self-extension loop (read the docs → write a capsule →
   build → install → the OS has a new skill → the new capsule ships its own docs
   and the catalog grows). Pull-quote styling for: "An agent on Astrid can extend
   itself. It can write a capsule, compile it, install it, and call it, all inside
   the sandbox, all recorded on the thread." CTA: **"Build one right now, in this
   tab"** → `/playground` (phase 3; until then the CTA reads "Playground: coming
   in this tab soon" and links to the book's capsule chapter — never a dead link).
6. **"Proof, not promises."** Compact: the five-layer gate as a diagram, the
   audit-chain widget showing the REAL entries this page generated (hash-linked,
   the visitor caused some of them in scene 4), link to security chapters.
7. **The books.** Two large cards: The Astrid Book ("engineers who want depth,
   36 chapters") and The Contributor Handbook ("people working ON Astrid").
   Styled spines/covers, link into `/book` and `/handbook`.
8. **Get started + footer.** brew install astrid, GitHub org, RFCs. Tagline
   sign-off: "Run AI agents and the tools they use without having to trust them."

### 5.2 `/book` and `/handbook` (phase 2)

Content collections reading `../../astrid-book/src` and `../../astrid-handbook/src`
directly (SUMMARY.md drives nav order). Site-styled reading experience: left nav
(collapsible parts), right in-page TOC, Plex Mono code blocks with the site
palette, prev/next footers, pagefind search. mdBook syntax quirks (SUMMARY.md
links, intra-book relative links) must resolve correctly. NOTHING is rewritten;
content renders verbatim from the source repos. Breadcrumb back to the main site.

### 5.3 `/playground` (phase 3)

Two-panel sandbox, "build a capability capsule in your tab":
- Left: CodeMirror 6 editor. Visitor writes a JS capsule (a small, honest framing:
  "capsules ship as WebAssembly; this sandbox lets you author one in JS against the
  same astrid:* host surface") with `on_event(topic, payload)` + manifest panel
  (name, subscriptions, requested capabilities as checkboxes: kv read/write,
  publish topics, log).
- Right: live rig. "Install" registers the visitor capsule against the REAL
  kernel: real bus subscription, real KV namespace, real capability grants for
  exactly the boxes ticked. A traffic generator publishes real events; visitor
  code handles them; attempts to use un-granted powers throw a real denial and
  stamp the real audit ledger. Bus viz + audit ledger same components as `/`.
- Showcase tab: "Run a REAL capsule": the jco-transpiled prompt-builder from
  spike/ executing its genuine `handle_assemble` path with host imports wired to
  the live kernel bus/KV instead of stubs (spike proved 3 interfaces suffice:
  ipc, kv, sys).

## 6. Performance and quality bars

- Wasm bundle lazy-loaded after first paint; hero renders instantly static, HUD
  flips to live when boot resolves. Target < 2.5s to live-kernel on a mid laptop.
- Lighthouse: 90+ performance on `/` (wasm excluded from blocking path), 100 a11y
  contrast. Keyboard reachable interactive scenes.
- Works with JS disabled as a static readable page (scenes show completed states).
- `npm run build` clean; no console errors on load; no unhandled promise
  rejections from the kernel bridge.

## 7. Phasing

- **Phase 1**: repo init + kernel-web + Astro scaffold + design system + `/`
  sections 1-4 fully live, 5-8 present with full copy/design but static art.
  HUD live. This is the "whoa" milestone.
- **Phase 2**: `/book` + `/handbook` + section 7 cards wired + pagefind.
- **Phase 3**: `/playground` + section 5 CTA flips live + section 6 audit widget
  interactive polish.

Each phase: Opus builds from a decision-free spec, orchestrator reviews the diff
adversarially, runs the build, and (with Joshua) eyeballs the page before the next
phase starts.

## 8. v2 — the site eats its own dog food (LOCKED)

### 8.1 Section capsules

Interactive page behaviour moves out of page scripts and into REAL Astrid
capsules: Rust, `astrid-sdk`, `wasm32-unknown-unknown`, componentized and
jco-transpiled, running against the in-tab kernel with the live host adapter
(the showcase machinery, generalized). The page becomes an uplink; the
behaviour is guest code. Three capsules under `site-capsules/`:

- **site-pulse** — owns the homepage routing demo. Input: `site.v1.clock.tick
  {n}` (published by the page; the page is the clock because a sandboxed guest
  has no timer authority). Behaviour: count ticks in KV (`pulse.count`),
  publish `site.v1.demo.route {n, count, via: "site-pulse"}`. Uninstall it and
  the routing pulses on the page STOP: disabling a capsule disables the page
  element, for real.
- **site-guard** — the layering demo. Input: `site.v1.input.text {text}`.
  If the text contains a blocklisted word (`password`, `secret`, `ssh`,
  case-insensitive) publish `site.v1.guard.blocked {reason, redacted}`;
  otherwise pass it through as `site.v1.guarded.text {text}`. Honesty label
  on the page: this ordering is BUS TOPOLOGY (guard owns the input topic,
  downstream listens to `guarded`), not kernel interceptor priority, which is
  a native-daemon feature.
- **site-echo** — sits BEHIND the guard. Input: `site.v1.guarded.text {text}`.
  Publish `site.v1.echo.reply {reply, seen}` with a KV-counted `seen`.
  Uninstall the guard while echo stays: raw input then reaches nobody
  (echo listens to `guarded.*` only) — the page explains exactly that.

HUD drawer grows an "installed capsules" rack: each section capsule shows
name, topics, and a real install/uninstall toggle (instantiate + grants on
install; revoke + drop on uninstall). All grants/revokes/denials land on the
real audit ledger.

### 8.2 Agent pill

Oval input docked to the rail, bottom of viewport. Opt-in LLM (WebLLM,
in-browser inference; weights download only on explicit click, size stated
up front). Without opt-in the pill is an honest docs lens: it knows where you
are (the page publishes `site.nav.v1.section {id}` as sections scroll in) and
surfaces the book chapters behind the current section. With the LLM enabled it
answers questions grounded in a build-time book index, and streams its status
over the real bus (`site.agent.v1.status {state}`,
`site.agent.v1.token {text}`) so the HUD and rail show the agent working.
Nothing pretends: pill states are labelled "docs lens" vs "agent (local LLM)".

### 8.3 Out of tab scope (tracked, not built here)

Browser-compile SDK (AssemblyScript candidate), local-daemon uplink to the
playground, GH-Pages registry, density benchmark: separate design docs.
