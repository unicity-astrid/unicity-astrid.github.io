/**
 * The fleet host: the REAL agentic capsules (react, session, openai-compat,
 * plus the already-shipped prompt-builder) running in-tab, wired together by
 * a synchronous re-entrant bus.
 *
 * Why this exists: react's turn begins with a blocking request/response to
 * session (subscribe → publish → recv). Against a naive host, recv returns
 * an empty envelope and the turn dies. Here, publish() ROUTES: it looks the
 * topic up in the fleet routing table (built from each capsule's real
 * Capsule.toml [subscribe] handlers) and invokes the target's genuine
 * `astridHookTrigger` export. Session's handler publishes its reply within
 * that same frame, the reply lands in react's subscription buffer, and
 * react's recv drains it — the kernel-router semantic, synchronously.
 *
 * Re-entrancy rule: the component model forbids re-entering an instance
 * that is mid-call, so dispatch is synchronous ONLY when the target is idle
 * and is not the publisher; otherwise it is deferred to a microtask (which
 * is exactly the asynchrony those interceptors have natively).
 *
 * The LLM leg: react publishes llm.v1.request.generate.openai-compat. The
 * host pre-generates the completion with the local model (WebLLM speaks the
 * OpenAI API — the same surface openai-compat fronts), then dispatches the
 * REAL openai-compat capsule, whose astrid:http import is answered from the
 * buffered completion as an OpenAI SSE stream. The capsule parses genuine
 * SSE and publishes genuine llm.v1.stream events; only the network is local.
 *
 * Every publish is also mirrored onto the real kernel bus, so the rail, the
 * HUD counters, and any page subscriber see the whole conversation.
 */

import type { AstridBridge } from './kernel';
import { completeOpenAi, pickModel } from './local-agent';
import { searchGuide, type Chapter } from './guide-lens';

// Model id the seeded provider selection carries; must match local-agent's.
// Set from the shared platform-aware picker at boot; the default only
// covers the window before bootFleet resolves it.
let FLEET_MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';

export interface FleetDef {
  name: string;
  /** [topic pattern, astridHookTrigger action] — from the real Capsule.toml. */
  routes: [string, string][];
  blurb: string;
}

/** Routing tables transcribed verbatim from each capsule's Capsule.toml. */
export const FLEET: FleetDef[] = [
  {
    name: 'session',
    routes: [
      ['session.v1.append', 'handle_append'],
      ['session.v1.request.get_messages', 'handle_get_messages'],
      ['session.v1.request.clear', 'handle_clear'],
      ['session.v1.request.list', 'handle_list'],
      ['session.v1.request.get_meta', 'handle_get_meta'],
      ['session.v1.request.update', 'handle_update'],
      ['session.v1.request.delete', 'handle_delete'],
      ['session.v1.request.search', 'handle_search'],
    ],
    blurb: 'thread history in kernel KV; every turn is recorded',
  },
  {
    name: 'react',
    routes: [
      ['user.v1.prompt', 'handle_user_prompt'],
      ['spark.v1.response.ready', 'handle_identity_response'],
      ['prompt_builder.v1.response.assemble', 'handle_prompt_response'],
      ['llm.v1.stream.*', 'handle_llm_stream'],
      ['tool.v1.execute.result', 'handle_tool_result'],
      ['registry.v1.active_model_changed', 'handle_model_changed'],
      ['session.v1.clear', 'handle_session_clear'],
    ],
    blurb: 'the agent loop itself: orchestrates every turn over the bus',
  },
  {
    name: 'openai-compat',
    routes: [
      // Dispatched via the async LLM leg, not directly (see publish()).
      ['llm.v1.request.generate.openai-compat', 'handle_llm_request'],
    ],
    blurb: 'the provider capsule; its HTTP is answered by the local model',
  },
  {
    name: 'prompt-builder',
    routes: [['prompt_builder.v1.assemble', 'handle_assemble']],
    blurb: 'assembles every prompt, same wasm as the native fleet',
  },
];

export type FleetState = 'unavailable' | 'installed' | 'uninstalled' | 'error';

interface Root {
  astridHookTrigger(action: string, payload: Uint8Array): { action?: string; data?: string };
  astridInstall?(): void;
}

interface Sub {
  pattern: string;
  buffer: { topic: string; payload: string }[];
}

interface Runtime {
  def: FleetDef;
  root: Root | null;
  state: FleetState;
  busy: boolean;
  subs: Set<Sub>;
}

const runtimes = new Map<string, Runtime>();
const deferred: (() => void)[] = [];
let flushScheduled = false;
let bridgeRef: AstridBridge | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  for (const l of listeners) l();
}
export function onFleet(l: Listener): () => void {
  listeners.add(l);
  l();
  return () => listeners.delete(l);
}
export function fleetState(name: string): FleetState {
  return runtimes.get(name)?.state ?? 'unavailable';
}
export function fleetReady(): boolean {
  return ['session', 'react', 'openai-compat', 'prompt-builder'].every(
    (n) => fleetState(n) === 'installed',
  );
}

/** Real TopicMatcher semantics: exact, trailing `.*` subtree, mid `*` one segment. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  const p = pattern.split('.');
  const t = topic.split('.');
  if (p[p.length - 1] === '*' && p.length >= 2) {
    // trailing .* : prefix plus one or more deeper segments
    const prefix = p.slice(0, -1);
    if (t.length <= prefix.length) {
      // mid-* handling still applies when counts are equal
      if (t.length !== p.length) return false;
    } else {
      return prefix.every((seg, i) => seg === '*' || seg === t[i]);
    }
  }
  if (p.length !== t.length) return false;
  return p.every((seg, i) => seg === '*' || seg === t[i]);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    while (deferred.length) {
      const job = deferred.shift()!;
      job();
    }
  });
}

/** Invoke a capsule handler, respecting the no-re-entrancy rule. */
function dispatch(target: Runtime, handler: string, payload: string): void {
  if (target.state !== 'installed' || !target.root) return;
  if (target.busy) {
    deferred.push(() => dispatch(target, handler, payload));
    scheduleFlush();
    return;
  }
  target.busy = true;
  try {
    const res = target.root.astridHookTrigger(handler, enc.encode(payload));
    if (res?.action === 'deny') {
      console.warn(`[fleet] ${target.def.name}.${handler} denied: ${res.data ?? ''}`);
    }
  } catch (err) {
    console.warn(`[fleet] ${target.def.name}.${handler} threw:`, err);
  } finally {
    target.busy = false;
    scheduleFlush();
  }
}

/**
 * Book grounding staged per session by fleetAsk BEFORE the turn's
 * user.v1.prompt goes out, so the spark responder (which supplies the
 * system prompt) can fold the retrieved excerpts in synchronously.
 */
const pendingGrounding = new Map<string, string>();

/** Page-side responders for fleet requests no in-tab capsule serves. */
const pageResponders: [string, (payload: string, from: string) => void][] = [
  [
    'spark.v1.request.build',
    (payload) => {
      // The identity capsule is not in this cut; the page IS the uplink, so
      // it supplies the system prompt (labelled honestly in the HUD).
      let sessionId = '';
      try {
        sessionId = (JSON.parse(payload) as { session_id?: string }).session_id ?? '';
      } catch {
        /* leave empty; react falls back to its default session */
      }
      fleetPublish('unicity-aos-site', 'spark.v1.response.ready', JSON.stringify({
        session_id: sessionId,
        prompt:
          'You are the Unicity AOS developer guide, an agent running locally in the visitor’s browser on Astrid Runtime. Unicity AOS is the product distribution; Astrid is the neutral operating-system runtime beneath it. Be brief, concrete, and honest. Answer only from the supplied developer-guide context and say when that context does not establish an answer.' +
          (pendingGrounding.get(sessionId) ?? ''),
      }));
    },
  ],
];

/**
 * The bus. Mirrors to the real kernel bus, buffers for recv, routes to the
 * fleet, and answers page-responder topics.
 */
export function fleetPublish(from: string, topic: string, payload: string): void {
  // Mirror onto the real kernel bus (rail, HUD, page subscribers).
  if (bridgeRef?.hostPublish) {
    try {
      bridgeRef.hostPublish(from, topic, payload);
    } catch {
      try {
        bridgeRef.hostPublish(from, topic, JSON.stringify(payload));
      } catch {
        /* mirror is best-effort; fleet routing below is the real path */
      }
    }
  }

  // Buffer for any fleet subscription (the recv path).
  for (const rt of runtimes.values()) {
    if (rt.state !== 'installed') continue;
    for (const sub of rt.subs) {
      if (topicMatches(sub.pattern, topic)) sub.buffer.push({ topic, payload });
    }
  }

  // Page responders.
  for (const [t, respond] of pageResponders) {
    if (t === topic) {
      // Deferred: the publisher's frame must unwind first.
      deferred.push(() => respond(payload, from));
      scheduleFlush();
    }
  }

  // Route to fleet handlers.
  for (const rt of runtimes.values()) {
    if (rt.def.name === from) continue; // never synchronously self-deliver
    for (const [pattern, handler] of rt.def.routes) {
      if (!topicMatches(pattern, topic)) continue;
      if (topic.startsWith('llm.v1.request.generate.')) {
        // The async LLM leg: pre-generate with the local model, then let
        // the REAL provider capsule parse it as an OpenAI SSE stream.
        void llmLeg(rt, handler, payload);
      } else {
        dispatch(rt, handler, payload);
      }
    }
  }
}

// ---- the openai-compat HTTP shim --------------------------------------

/** SSE chunks staged for the next httpStreamStart call. */
let stagedSse: string[] | null = null;

function sseChunksFor(text: string): string[] {
  // Word-sized deltas so the capsule's SSE parser does real incremental work.
  const words = text.match(/\S+\s*/g) ?? [text];
  const chunks = words.map(
    (w) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: w } }] })}\n\n`,
  );
  chunks.push(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
  );
  chunks.push('data: [DONE]\n\n');
  return chunks;
}

async function llmLeg(provider: Runtime, handler: string, payload: string): Promise<void> {
  if (!bridgeRef) return;
  try {
    const req = JSON.parse(payload) as {
      messages?: { role: string; content: unknown }[];
      system?: string;
      max_tokens?: number;
    };
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    for (const m of req.messages ?? []) {
      messages.push({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }
    const text = await completeOpenAi(bridgeRef, messages, Math.min(req.max_tokens ?? 400, 400));
    stagedSse = sseChunksFor(text);
    dispatch(provider, handler, payload);
  } catch (err) {
    console.warn('[fleet] llm leg failed:', err);
    // Surface the failure as a real stream error event so react's turn
    // terminates through its own error path instead of hanging.
    fleetPublish('unicity-aos-site', 'llm.v1.stream.openai-compat', JSON.stringify({
      type: 'llm_stream_event',
      request_id: (JSON.parse(payload) as { request_id?: string }).request_id ?? '',
      event: { Error: `local model failed: ${err instanceof Error ? err.message : err}` },
    }));
  } finally {
    stagedSse = null;
  }
}

// ---- per-capsule host imports ------------------------------------------

function hostFor(name: string): Record<string, unknown> {
  const ns = `fleet.${name}`;
  const rt = () => runtimes.get(name)!;

  class Subscription {
    #sub: Sub;
    constructor(pattern: string) {
      this.#sub = { pattern, buffer: [] };
      rt().subs.add(this.#sub);
    }
    recv(_timeoutMs: bigint) {
      const msgs = this.#sub.buffer.splice(0);
      return {
        messages: msgs.map((m) => ({
          topic: m.topic,
          payload: m.payload,
          sourceId: 'unicity-aos-site',
          principal: { tag: 'system' as const },
        })),
        dropped: 0n,
        lagged: 0n,
      };
    }
  }

  const ipc = {
    Subscription,
    publish(topic: string, payload: string) {
      fleetPublish(name, topic, payload);
    },
    subscribe(topicPattern: string) {
      return new Subscription(topicPattern);
    },
  };

  const b = () => {
    if (!bridgeRef) throw new Error('kernel offline');
    return bridgeRef;
  };
  const kv = {
    kvGet(key: string): Uint8Array | undefined {
      const v = b().hostKvGetSync!(ns, key);
      return v === undefined ? undefined : enc.encode(v);
    },
    kvSet(key: string, value: Uint8Array) {
      b().hostKvSetSync!(ns, key, dec.decode(value));
    },
    kvDelete(key: string) {
      b().hostKvDeleteSync?.(ns, key);
    },
    kvCas(key: string, expected: Uint8Array | undefined, value: Uint8Array): boolean {
      return b().hostKvCasSync!(
        ns,
        key,
        expected === undefined ? undefined : dec.decode(expected),
        dec.decode(value),
      );
    },
    kvListKeys(): string[] {
      return b().hostKvListKeysSync!(ns, undefined);
    },
    kvListKeysPage(_cursor: string | undefined, _limit: bigint) {
      // One-page answer over the real store: the in-tab store is small, so
      // every listing fits a single page and the cursor is always exhausted.
      const keys = b().hostKvListKeysSync!(ns, undefined);
      return { keys, cursor: undefined };
    },
    kvClearPrefix(prefix: string): bigint {
      return b().hostKvClearPrefixSync?.(ns, prefix) ?? 0n;
    },
  };

  const CONFIG: Record<string, Record<string, string>> = {
    react: { workspace_root: '/workspace' },
    'openai-compat': {
      base_url: 'https://llm.tab.local',
      model: FLEET_MODEL,
      // The capsule's generate path requires a non-empty key (it refuses to
      // run keyless). This placeholder goes into an Authorization header on a
      // request that never leaves the tab: our in-page HTTP shim answers it
      // from the local model and ignores headers entirely. Not a secret.
      api_key: 'in-tab-local',
    },
  };
  const t0 = performance.now();
  const sys = {
    getConfig(key: string): string | undefined {
      return CONFIG[name]?.[key];
    },
    log(level: string, message: string) {
      if (level === 'warn' || level === 'error') {
        console.warn(`[fleet:${name}] ${message}`);
      }
    },
    clockMs(): bigint {
      return BigInt(Date.now());
    },
    clockMonotonicNs(): bigint {
      return BigInt(Math.trunc((performance.now() - t0) * 1e6));
    },
    randomBytes(length: bigint): Uint8Array {
      const out = new Uint8Array(Number(length));
      crypto.getRandomValues(out);
      return out;
    },
    signalReady() {},
    checkCapsuleCapability() {
      return { allowed: false };
    },
  };

  class HttpStream {
    #chunks: string[];
    constructor(chunks: string[]) {
      this.#chunks = chunks;
    }
    status(): number {
      return 200;
    }
    headers() {
      return [{ key: 'content-type', value: 'text/event-stream' }];
    }
    readChunk(): Uint8Array {
      const next = this.#chunks.shift();
      return next === undefined ? new Uint8Array(0) : enc.encode(next);
    }
  }
  const http = {
    HttpStream,
    httpRequest() {
      throw { tag: 'unknown', val: 'in-tab fleet host serves streaming only' };
    },
    httpStreamStart(_req: unknown) {
      if (!stagedSse) {
        throw { tag: 'unknown', val: 'no completion staged (llm leg not active)' };
      }
      const stream = new HttpStream(stagedSse);
      stagedSse = null;
      return stream;
    },
  };

  const imports: Record<string, unknown> = {
    'astrid:ipc/host': ipc,
    'astrid:kv/host': kv,
    'astrid:sys/host': sys,
    'astrid:http/host': http,
    'astrid:guest/lifecycle': {},
    'astrid:ipc/host@1.0.0': ipc,
    'astrid:kv/host@1.0.0': kv,
    'astrid:sys/host@1.0.0': sys,
    'astrid:http/host@1.0.0': http,
    'astrid:guest/lifecycle@1.0.0': {},
  };
  return imports;
}

// ---- lifecycle ----------------------------------------------------------

const MODULES = import.meta.glob('../fleet/*/*.component.js');
const SHOWCASE_PB = () => import('../showcase/prompt-builder.component.js');

function loaderFor(name: string): (() => Promise<unknown>) | null {
  if (name === 'prompt-builder') return SHOWCASE_PB as () => Promise<unknown>;
  for (const [path, load] of Object.entries(MODULES)) {
    if (path.includes(`/fleet/${name}/`)) return load as () => Promise<unknown>;
  }
  return null;
}

function wasmBase(name: string): string {
  return name === 'prompt-builder' ? '/showcase' : `/fleet/${name}`;
}

export async function bootFleet(bridge: AstridBridge): Promise<void> {
  FLEET_MODEL = await pickModel();
  bridgeRef = bridge;
  if (!bridge.hostKvCasSync || !bridge.hostKvListKeysSync) {
    console.warn('[fleet] bridge predates the fleet KV surface; fleet stays offline');
    return;
  }

  for (const def of FLEET) {
    const rt: Runtime = runtimes.get(def.name) ?? {
      def,
      root: null,
      state: 'unavailable',
      busy: false,
      subs: new Set(),
    };
    runtimes.set(def.name, rt);
    if (rt.root) continue; // survives client-router navigations
    const load = loaderFor(def.name);
    if (!load) continue;
    try {
      const mod = (await load()) as {
        instantiate(
          getCoreModule: (path: string) => Promise<WebAssembly.Module>,
          imports: unknown,
        ): Promise<Root> | Root;
      };
      const getCoreModule = async (path: string) =>
        WebAssembly.compile(await (await fetch(`${wasmBase(def.name)}/${path}`)).arrayBuffer());
      const root = await mod.instantiate(getCoreModule, hostFor(def.name) as never);
      root.astridInstall?.();
      rt.root = root;
      rt.state = 'installed';
    } catch (err) {
      console.warn(`[fleet] ${def.name} failed to load:`, err);
      rt.state = 'error';
    }
  }

  // Pre-seed react's provider selection so its first turn skips the
  // registry round-trip (there is no registry capsule in this cut).
  if (fleetState('react') === 'installed') {
    bridge.hostKvSetSync!('fleet.react', 'llm_provider_topic', 'llm.v1.request.generate.openai-compat');
    bridge.hostKvSetSync!('fleet.react', 'react.llm_provider_model', FLEET_MODEL);
  }

  notify();
}

export function toggleFleetCapsule(name: string): void {
  const rt = runtimes.get(name);
  if (!rt) return;
  if (rt.state === 'installed') rt.state = 'uninstalled';
  else if (rt.state === 'uninstalled') rt.state = 'installed';
  notify();
}

/**
 * Page-side entry: retrieve developer-guide grounding for the question, stage it for
 * the spark responder, then publish the real user prompt into the fleet.
 * Returns the chapters used so the caller can show what grounded the turn.
 */
export async function fleetAsk(sessionId: string, text: string): Promise<Chapter[]> {
  let chapters: Chapter[] = [];
  try {
    chapters = await searchGuide(text, 2);
  } catch {
    /* index unavailable; the turn runs on the base prompt alone */
  }
  pendingGrounding.set(
    sessionId,
    chapters.length
      ? '\n\nDeveloper Guide excerpts relevant to the visitor’s question:\n\n' +
        chapters.map((c) => `## ${c.title}\n${c.text.slice(0, 1400)}`).join('\n\n') +
        '\n\nAnswer only from these excerpts. If they do not cover the question, say so and name the closest chapter.'
      : '',
  );
  fleetPublish('unicity-aos-site', 'user.v1.prompt', JSON.stringify({
    type: 'user_input',
    text,
    session_id: sessionId,
    context: null,
  }));
  return chapters;
}
