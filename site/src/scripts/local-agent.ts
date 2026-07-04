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
// fleet. NON-THINKING models only: the Qwen3/3.5 hybrid-reasoning line
// free-runs <think> blocks in WebLLM (its ported chat template has no
// working thinking switch), and an 0.8B thinker rings degenerate loops at
// visitors. Desktop gets Llama 3.2 1B. Gemma 3 1B is OUT: its WebLLM
// record shipped a window-size conflict AND its q4f16 cut degenerates
// into two-word repetition loops on real questions — two strikes. No-f16
// desktops (many Android-class GPUs are desktop-shaped too) get the same
// Llama in q4f32. Phones get SmolLM2-360M:
// iOS Safari kills tabs long before a 1B's working set, and a small brain
// beats a crashed tab.
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
    ? (f16 ? 'SmolLM2-360M-Instruct-q4f16_1-MLC' : 'SmolLM2-360M-Instruct-q4f32_1-MLC')
    : (f16 ? 'Llama-3.2-1B-Instruct-q4f16_1-MLC' : 'Llama-3.2-1B-Instruct-q4f32_1-MLC');
  return picked;
}

/** Human size label for the consent line, matching pickModel's choice. */
export async function pickModelSize(): Promise<string> {
  const m = await pickModel();
  if (m.startsWith('SmolLM2')) return m.includes('q4f32') ? '~370 MB' : '~250 MB';
  if (m.startsWith('Llama')) return m.includes('q4f32') ? '~800 MB' : '~600 MB';
  return '~550 MB';
}

interface Engine {
  chat: {
    completions: {
      create(opts: {
        messages: { role: string; content: string }[];
        stream: true;
        temperature?: number;
        max_tokens?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
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

// Defensive only — the ladder is non-thinking models, but if one ever
// emits a <think> block anyway (or a brought endpoint runs a reasoning
// model), hide complete blocks and any still-open one from visitors.
function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trimStart();
}

// NEVER show think text to a visitor — a turn that dies inside a think
// block reads as raving. The ladder is non-thinking models, so an empty
// strict strip means the turn failed; the pill says so honestly instead.

// The gemma3 record ships BOTH context_window_size and sliding_window_size
// positive (Gemma's sliding-window architecture) and the engine refuses the
// pair: pin a plain 4k full-attention window instead.
function chatOptsFor(model: string): Record<string, number> | undefined {
  if (model.startsWith('gemma3')) {
    return { context_window_size: 4096, sliding_window_size: -1 };
  }
  return undefined;
}

// If a model's record is broken in this WebLLM cut, fall back to the next
// best non-thinking model instead of leaving the visitor with a dead pill.
function fallbackFor(model: string): string | null {
  if (model.startsWith('gemma3')) return 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  if (model.startsWith('Llama')) return 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
  if (model.startsWith('SmolLM2')) return 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
  return null;
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
  const webllm = await import('@mlc-ai/web-llm');
  const first = await pickModel();
  const candidates = [first, fallbackFor(first)].filter((m): m is string => m !== null);
  let lastErr: unknown = null;
  for (const model of candidates) {
    publishStatus(bridge, 'loading', `downloading ${model}`);
    try {
      engine = (await webllm.CreateMLCEngine(
        model,
        {
          initProgressCallback: (p: { text: string; progress: number }) => {
            onProgress(p.text, p.progress ?? 0);
            void bridge.publish(
              'site.agent.v1.status',
              JSON.stringify({ state: 'loading', detail: p.text }),
            );
          },
        },
        chatOptsFor(model),
      )) as unknown as Engine;
      picked = model; // keep removeModel and the fleet in sync with reality
      publishStatus(bridge, 'ready', 'local model loaded, running on your GPU');
      return true;
    } catch (err) {
      engine = null;
      lastErr = err;
      console.warn(`[agent] ${model} failed to load:`, err);
    }
  }
  publishStatus(
    bridge,
    'off',
    `model load failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
  return false;
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
  // "nothing left behind" includes weights this site shipped in EARLIER
  // cuts — a returning visitor's cache may hold one of those instead
  const shipped = [
    model,
    'gemma3-1b-it-q4f16_1-MLC',
    'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    'SmolLM2-360M-Instruct-q4f16_1-MLC',
    'SmolLM2-360M-Instruct-q4f32_1-MLC',
    'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    'Qwen3.5-0.8B-q4f16_1-MLC',
    'Qwen3.5-0.8B-q4f32_1-MLC',
    'Qwen3-0.6B-q4f16_1-MLC',
    'Qwen3-0.6B-q4f32_1-MLC',
    'gemma-2-2b-it-q4f16_1-MLC',
  ];
  for (const id of shipped) {
    try {
      await webllm.deleteModelAllInfoInCache(id);
    } catch {
      /* absent = already clean */
    }
  }
  publishStatus(bridge, 'off', 'model removed from this browser — nothing left behind');
}

/**
 * Connect an OpenAI-compatible endpoint instead of downloading anything.
 * Verified with a real /models request before being accepted. The key is
 * held in memory only. Works without WebGPU — the model is elsewhere.
 *
 * People paste the server root (http://localhost:1234) as often as the API
 * base (…/v1), so both are tried. Some servers (LM Studio) answer 200 on
 * wrong paths, so a status check proves nothing — only a real model list
 * counts as a working base.
 */
export async function connectEndpoint(bridge: AstridBridge, e: AgentEndpoint): Promise<void> {
  const typed = e.base.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (e.key) headers.Authorization = `Bearer ${e.key}`;
  const candidates = /\/v\d+$/.test(typed) ? [typed] : [typed, `${typed}/v1`];
  let base: string | null = null;
  let lastError = 'endpoint did not answer';
  for (const c of candidates) {
    try {
      const res = await fetch(`${c}/models`, { headers });
      if (!res.ok) {
        lastError = `endpoint answered ${res.status} on ${c}/models`;
        continue;
      }
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data)) {
        lastError = `${c}/models did not return a model list — wrong path?`;
        continue;
      }
      base = c;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!base) throw new Error(lastError);
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
        temperature: 0.55,
        frequency_penalty: 0.4,
        presence_penalty: 0.3,
        max_tokens: maxTokens,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) throw new Error(`endpoint answered ${res.status}`);
    // SSE: `data: {...}` lines, terminated by `data: [DONE]`. Events can
    // split across network chunks, so buffer to the last newline.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let raw = '';
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const t = json.choices?.[0]?.delta?.content ?? '';
          if (!t) continue;
          raw += t;
          n += 1;
          onDelta(stripThink(raw), n);
        } catch {
          /* keep-alive comments and partial junk are legal SSE; skip */
        }
      }
    }
    return stripThink(raw);
  }
  if (!engine) throw new Error('no model: download one or connect an endpoint');
  let raw = '';
  let n = 0;
  // The penalties are load-bearing: 1B-class quantized models at low
  // temperature ring two-word loops ("The core. The core.") without them.
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.55,
    frequency_penalty: 0.4,
    presence_penalty: 0.3,
    max_tokens: maxTokens,
  });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content ?? '';
    if (!t) continue;
    raw += t;
    n += 1;
    onDelta(stripThink(raw), n);
  }
  return stripThink(raw);
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
  const full = await generate(messages, maxTokens, (t, n) => {
    if (n - last >= 4) {
      last = n;
      void bridge.publish('site.agent.v1.token', JSON.stringify({ n }));
      // Running text for the pill: the fleet's final answer arrives only
      // when the react loop finishes, so this is the visitor's live view.
      void bridge.publish('site.agent.v1.partial', JSON.stringify({ text: t }));
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
        'You are the Astrid site guide, running locally in the visitor’s browser tab on the Astrid kernel’s own page. Astrid is NOT hypothetical or simulated: it is a real, shipped operating system for AI agents, and a real instance is running in this tab right now. Answer briefly (a few sentences) and only from the provided book excerpts. If the excerpts do not cover the question, say so and name the closest chapter.',
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
