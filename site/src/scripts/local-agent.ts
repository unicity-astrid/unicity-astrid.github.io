/**
 * Opt-in local agent. Two ways to get a brain, both private:
 *
 *  - DOWNLOAD: WebLLM running a small instruct model entirely in the
 *    visitor's tab (WebGPU). Weights download once from the model host
 *    after an explicit click that states the size, cached by the browser —
 *    and removable: removeModel() really deletes the cached weights.
 *  - BRING YOUR OWN: any OpenAI-compatible endpoint (Ollama or LM Studio on
 *    localhost, or a hosted API). The key, if any, lives in this module's
 *    memory for the life of the tab and is never persisted anywhere.
 *
 * Every state change is published on the REAL bus (site.agent.v1.status) so
 * the HUD, the rail, and any capsule can watch the agent work; token
 * progress ticks out as site.agent.v1.token. The pill renders from these
 * same events: what you see is what the bus carried.
 */
import type { AstridBridge } from './kernel';
import type { Chapter } from './book-lens';

export type AgentState = 'off' | 'unsupported' | 'loading' | 'ready' | 'thinking';

// Platform-aware model pick, one source of truth for the pill AND the
// fleet. Qwen3.5-0.8B is the sweet spot as of mid-2026: two generations
// newer than the 0.5B that confabulated "Astrid is hypothetical" (fatal on
// a site whose pitch is that nothing is staged), at ~450 MB instead of the
// 1 GB+ the good Gemmas cost. Phones drop to Qwen3-0.6B: iOS Safari kills
// tabs well past ~500 MB of weights, and a smaller brain beats a crashed
// tab. q4f16 builds need the GPU to expose shader-f16 (absent on most
// Android/Adreno); both lines ship q4f32 fallbacks, so every WebGPU device
// has a working variant.
let picked = '';
export async function pickModel(): Promise<string> {
  if (picked) return picked;
  let f16 = false;
  try {
    const adapter = await (navigator as unknown as {
      gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
    }).gpu?.requestAdapter();
    f16 = adapter?.features.has('shader-f16') ?? false;
  } catch {
    /* no adapter: callers gate on webGpuAvailable() anyway */
  }
  const mobile =
    /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent) ||
    ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  picked = mobile
    ? (f16 ? 'Qwen3-0.6B-q4f16_1-MLC' : 'Qwen3-0.6B-q4f32_1-MLC')
    : (f16 ? 'Qwen3.5-0.8B-q4f16_1-MLC' : 'Qwen3.5-0.8B-q4f32_1-MLC');
  return picked;
}

/** Human size label for the consent line, matching pickModel's choice. */
export async function pickModelSize(): Promise<string> {
  const m = await pickModel();
  return m.includes('0.6B') ? '~350 MB' : '~450 MB';
}

interface Engine {
  chat: {
    completions: {
      create(opts: {
        messages: { role: string; content: string }[];
        stream: true;
        temperature?: number;
        max_tokens?: number;
      }): Promise<AsyncIterable<{ choices: { delta?: { content?: string } }[] }>>;
    };
  };
  unload?(): Promise<void>;
}

export interface AgentEndpoint {
  /** OpenAI-compatible base, e.g. http://localhost:11434/v1 */
  base: string;
  /** memory-only; never persisted */
  key?: string;
  model?: string;
}

let engine: Engine | null = null;
let endpoint: AgentEndpoint | null = null;
let state: AgentState = 'off';

export function agentState(): AgentState {
  return state;
}

export function agentReady(): boolean {
  return engine !== null || endpoint !== null;
}

export function endpointInfo(): AgentEndpoint | null {
  return endpoint ? { ...endpoint, key: endpoint.key ? '(in memory)' : undefined } : null;
}

function publishStatus(bridge: AstridBridge, next: AgentState, detail: string): void {
  state = next;
  void bridge.publish('site.agent.v1.status', JSON.stringify({ state: next, detail }));
}

export function webGpuAvailable(): boolean {
  return 'gpu' in navigator;
}

// Qwen3-family models may think out loud in <think> blocks (the /no_think
// switch in our prompts asks them not to, but belt and suspenders): hide
// complete blocks and any still-open one from what visitors see.
function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trimStart();
}

// End-of-turn version: if the model burned its whole token budget inside a
// think block, the strict strip leaves NOTHING — an empty answer is worse
// than a rough one, so salvage the reasoning text as the reply.
function visibleText(raw: string): string {
  const strict = stripThink(raw);
  if (strict) return strict;
  return raw.replace(/<\/?think>/g, '').trimStart();
}

// Qwen3's thinking switch binds to the LAST user message, not the system
// prompt. Applied only to the in-tab engine (a brought endpoint may be any
// model family; we don't decorate someone else's prompts).
function withNoThink(
  messages: { role: string; content: string }[],
): { role: string; content: string }[] {
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      out[i].content += ' /no_think';
      break;
    }
  }
  return out;
}

/** Download and boot the model. Progress goes to the bus and the callback. */
export async function enableAgent(
  bridge: AstridBridge,
  onProgress: (text: string, progress: number) => void,
): Promise<boolean> {
  if (engine) return true;
  if (!webGpuAvailable()) {
    publishStatus(bridge, 'unsupported', 'WebGPU not available in this browser');
    return false;
  }
  const model = await pickModel();
  publishStatus(bridge, 'loading', `downloading ${model}`);
  try {
    const webllm = await import('@mlc-ai/web-llm');
    engine = (await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p: { text: string; progress: number }) => {
        onProgress(p.text, p.progress ?? 0);
        void bridge.publish(
          'site.agent.v1.status',
          JSON.stringify({ state: 'loading', detail: p.text }),
        );
      },
    })) as unknown as Engine;
    publishStatus(bridge, 'ready', 'local model loaded, running on your GPU');
    return true;
  } catch (err) {
    engine = null;
    publishStatus(bridge, 'off', `model load failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Really remove the downloaded model: unload the engine and delete the
 * cached weights, config, and wasm from the browser. The visitor's machine
 * is left as it was before they said yes.
 */
export async function removeModel(bridge: AstridBridge): Promise<void> {
  const model = await pickModel();
  try {
    await engine?.unload?.();
  } catch {
    /* the engine may already be gone; cache deletion is the point */
  }
  engine = null;
  localStorage.removeItem('astrid-agent-optin');
  const webllm = await import('@mlc-ai/web-llm');
  await webllm.deleteModelAllInfoInCache(model);
  publishStatus(bridge, 'off', 'model removed from this browser — nothing left behind');
}

/**
 * Connect an OpenAI-compatible endpoint instead of downloading anything.
 * Verified with a real /models request before being accepted. The key is
 * held in memory only. Works without WebGPU — the model is elsewhere.
 */
export async function connectEndpoint(bridge: AstridBridge, e: AgentEndpoint): Promise<void> {
  const base = e.base.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  const res = await fetch(`${base}/models`, { headers });
  if (!res.ok) throw new Error(`endpoint answered ${res.status} on /models`);
  endpoint = { ...e, base };
  const host = new URL(base).host;
  publishStatus(bridge, 'ready', `your model · ${host}${e.model ? ` · ${e.model}` : ''}`);
}

export function disconnectEndpoint(bridge: AstridBridge): void {
  endpoint = null;
  publishStatus(bridge, engine ? 'ready' : 'off', engine ? 'back to the in-tab model' : 'endpoint disconnected');
}

/** One generate path for both brains; onDelta receives the running text. */
async function generate(
  messages: { role: string; content: string }[],
  maxTokens: number,
  onDelta: (full: string, tokens: number) => void,
): Promise<string> {
  if (endpoint) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (endpoint.key) headers.Authorization = `Bearer ${endpoint.key}`;
    const res = await fetch(`${endpoint.base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: endpoint.model || 'default',
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`endpoint answered ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = stripThink(json.choices?.[0]?.message?.content ?? '');
    onDelta(text, 1);
    return text;
  }
  if (!engine) throw new Error('no model: download one or connect an endpoint');
  let raw = '';
  let n = 0;
  const stream = await engine.chat.completions.create({
    messages: withNoThink(messages),
    stream: true,
    temperature: 0.3,
    max_tokens: maxTokens,
  });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content ?? '';
    if (!t) continue;
    raw += t;
    n += 1;
    onDelta(stripThink(raw), n);
  }
  return visibleText(raw);
}

/**
 * Raw OpenAI-shaped completion for the fleet's provider shim: the real
 * openai-compat capsule emits an OpenAI /v1/chat/completions request over
 * astrid:http, and the page answers it from whichever brain is connected.
 * Returns the full text (the capsule's SSE loop is synchronous, so the
 * completion is generated first and fed to it as buffered chunks).
 */
export async function completeOpenAi(
  bridge: AstridBridge,
  messages: { role: string; content: string }[],
  maxTokens: number,
): Promise<string> {
  publishStatus(bridge, 'thinking', 'fleet turn');
  let last = 0;
  const full = await generate(messages, maxTokens, (_t, n) => {
    if (n - last >= 8) {
      last = n;
      void bridge.publish('site.agent.v1.token', JSON.stringify({ n }));
    }
  });
  publishStatus(bridge, 'ready', 'fleet turn finished');
  return full;
}

/**
 * Answer a question grounded in retrieved book chapters, streaming tokens.
 * `history` carries prior turns so the conversation is genuinely a session,
 * not a series of one-shots (most recent turns only; the model is small).
 */
export async function askAgent(
  bridge: AstridBridge,
  question: string,
  context: Chapter[],
  history: { role: 'user' | 'assistant'; content: string }[],
  onToken: (full: string) => void,
): Promise<string> {
  publishStatus(bridge, 'thinking', question.slice(0, 80));

  const grounding = context
    .map((c) => `## ${c.title}\n${c.text.slice(0, 1600)}`)
    .join('\n\n');
  const messages = [
    {
      role: 'system',
      content:
        'You are the Astrid site guide, running locally in the visitor’s browser tab on the Astrid kernel’s own page. Astrid is NOT hypothetical or simulated: it is a real, shipped operating system for AI agents, and a real instance is running in this tab right now. Answer briefly (a few sentences) and only from the provided book excerpts. If the excerpts do not cover the question, say so and name the closest chapter. /no_think',
    },
    ...history.slice(-6),
    { role: 'user', content: `Book excerpts:\n\n${grounding}\n\nQuestion: ${question}` },
  ];

  let tokens = 0;
  const full = await generate(messages, 340, (text, n) => {
    tokens = n;
    if (n % 8 === 0) void bridge.publish('site.agent.v1.token', JSON.stringify({ n }));
    onToken(text);
  });
  publishStatus(bridge, 'ready', `answered in ${tokens} tokens`);
  return full;
}
