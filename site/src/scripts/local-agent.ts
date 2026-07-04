/**
 * Opt-in local agent: WebLLM running a small instruct model entirely in the
 * visitor's tab (WebGPU). Nothing leaves the machine; the weights download
 * once from the model host after an explicit click that states the size.
 *
 * Every state change is published on the REAL bus (site.agent.v1.status) so
 * the HUD, the rail, and any capsule can watch the agent work; token
 * progress ticks out as site.agent.v1.token. The pill renders from these
 * same events: what you see is what the bus carried.
 */
import type { AstridBridge } from './kernel';
import type { Chapter } from './book-lens';

export type AgentState = 'off' | 'unsupported' | 'loading' | 'ready' | 'thinking';

const MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

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
}

let engine: Engine | null = null;
let state: AgentState = 'off';

export function agentState(): AgentState {
  return state;
}

function publishStatus(bridge: AstridBridge, next: AgentState, detail: string): void {
  state = next;
  void bridge.publish('site.agent.v1.status', JSON.stringify({ state: next, detail }));
}

export function webGpuAvailable(): boolean {
  return 'gpu' in navigator;
}

/** Download and boot the model. Progress goes to the bus and the callback. */
export async function enableAgent(
  bridge: AstridBridge,
  onProgress: (text: string) => void,
): Promise<boolean> {
  if (engine) return true;
  if (!webGpuAvailable()) {
    publishStatus(bridge, 'unsupported', 'WebGPU not available in this browser');
    return false;
  }
  publishStatus(bridge, 'loading', `downloading ${MODEL}`);
  try {
    const webllm = await import('@mlc-ai/web-llm');
    engine = (await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (p: { text: string }) => {
        onProgress(p.text);
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

/** Answer a question grounded in retrieved book chapters, streaming tokens. */
export async function askAgent(
  bridge: AstridBridge,
  question: string,
  context: Chapter[],
  onToken: (full: string) => void,
): Promise<string> {
  if (!engine) throw new Error('agent not enabled');
  publishStatus(bridge, 'thinking', question.slice(0, 80));

  const grounding = context
    .map((c) => `## ${c.title}\n${c.text.slice(0, 1600)}`)
    .join('\n\n');
  const messages = [
    {
      role: 'system',
      content:
        'You are the Astrid site guide, running locally in the visitor’s browser tab on the Astrid kernel’s own page. Answer briefly (a few sentences) and only from the provided book excerpts. If the excerpts do not cover the question, say so and name the closest chapter.',
    },
    { role: 'user', content: `Book excerpts:\n\n${grounding}\n\nQuestion: ${question}` },
  ];

  let full = '';
  let n = 0;
  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.3,
    max_tokens: 220,
  });
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content ?? '';
    if (!t) continue;
    full += t;
    n += 1;
    if (n % 8 === 0) {
      void bridge.publish('site.agent.v1.token', JSON.stringify({ n }));
    }
    onToken(full);
  }
  publishStatus(bridge, 'ready', `answered in ${n} tokens`);
  return full;
}
