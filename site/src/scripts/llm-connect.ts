/**
 * llm-connect — site-side shim for "bring your model to this website".
 *
 * Deliberately standalone (no Astrid imports): this is the seed of an
 * open, wallet-agnostic connector. It answers two questions:
 *
 *   1. detect — what model providers does this visitor already run?
 *      Probes the well-known localhost servers (LM Studio, Ollama,
 *      llama.cpp, Jan) with short timeouts. Uses each server's NATIVE
 *      API where it tells us more (LM Studio's /api/v0 knows which
 *      model is actually loaded) and falls back to the OpenAI-compat
 *      surface. Detection is best-effort: a server with CORS disabled
 *      is invisible, not an error.
 *
 *   2. verify — for bring-your-key cloud APIs (Anthropic supports
 *      browser calls explicitly via its CORS opt-in header; OpenAI
 *      accepts a Bearer key), check the key with a real model-list
 *      request and return what it can run.
 *
 * No key or URL ever touches storage — callers hold results in memory.
 */

export type ProviderFlavor = 'openai' | 'anthropic';

export interface DetectedProvider {
  id: string;
  label: string;
  /** chat base (OpenAI-compatible /v1 for every local provider) */
  base: string;
  flavor: ProviderFlavor;
  models: string[];
  /** model the server reports as already loaded, when it knows */
  loaded?: string;
}

export interface CloudProvider {
  id: string;
  label: string;
  base: string;
  flavor: ProviderFlavor;
  keyHint: string;
  modelHint: string;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    base: 'https://api.anthropic.com',
    flavor: 'anthropic',
    keyHint: 'sk-ant-…',
    modelHint: 'claude-haiku-4-5',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    flavor: 'openai',
    keyHint: 'sk-…',
    modelHint: 'gpt-5-mini',
  },
];

async function probeJson(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = 1500,
): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function detectLmStudio(): Promise<DetectedProvider | null> {
  const root = 'http://localhost:1234';
  // Native API first: it reports load state, so the picker can preselect
  // the model the visitor is actually running.
  const native = (await probeJson(`${root}/api/v0/models`)) as {
    data?: { id?: string; type?: string; state?: string }[];
  } | null;
  if (native?.data?.length) {
    const llms = native.data.filter((m) => m.id && m.type !== 'embeddings');
    if (llms.length) {
      return {
        id: 'lmstudio',
        label: 'LM Studio',
        base: `${root}/v1`,
        flavor: 'openai',
        models: llms.map((m) => m.id as string),
        loaded: llms.find((m) => m.state === 'loaded')?.id,
      };
    }
  }
  const compat = (await probeJson(`${root}/v1/models`)) as { data?: { id?: string }[] } | null;
  if (!compat?.data?.length) return null;
  return {
    id: 'lmstudio',
    label: 'LM Studio',
    base: `${root}/v1`,
    flavor: 'openai',
    models: compat.data.map((m) => m.id).filter((x): x is string => !!x),
  };
}

async function detectOllama(): Promise<DetectedProvider | null> {
  const root = 'http://localhost:11434';
  const tags = (await probeJson(`${root}/api/tags`)) as { models?: { name?: string }[] } | null;
  if (!tags?.models?.length) return null;
  return {
    id: 'ollama',
    label: 'Ollama',
    base: `${root}/v1`,
    flavor: 'openai',
    models: tags.models.map((m) => m.name).filter((x): x is string => !!x),
  };
}

async function detectOpenAiCompat(
  id: string,
  label: string,
  base: string,
): Promise<DetectedProvider | null> {
  const json = (await probeJson(`${base}/models`)) as { data?: { id?: string }[] } | null;
  if (!json || !Array.isArray(json.data) || !json.data.length) return null;
  return {
    id,
    label,
    base,
    flavor: 'openai',
    models: json.data.map((m) => m.id).filter((x): x is string => !!x),
  };
}

/** Probe every well-known local server in parallel; absent ones just miss. */
export async function detectLocalProviders(): Promise<DetectedProvider[]> {
  const found = await Promise.all([
    detectLmStudio(),
    detectOllama(),
    detectOpenAiCompat('llamacpp', 'llama.cpp', 'http://localhost:8080/v1'),
    detectOpenAiCompat('jan', 'Jan', 'http://localhost:1337/v1'),
  ]);
  return found.filter((p): p is DetectedProvider => p !== null);
}

/**
 * Verify a cloud key with a real model-list request. Returns the model ids
 * the key can use, or throws with the provider's own error. The key goes
 * to the provider and nowhere else.
 */
export async function verifyCloudKey(provider: CloudProvider, key: string): Promise<string[]> {
  const headers: Record<string, string> =
    provider.flavor === 'anthropic'
      ? {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { Authorization: `Bearer ${key}` };
  const url =
    provider.flavor === 'anthropic' ? `${provider.base}/v1/models` : `${provider.base}/models`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${provider.label} answered ${res.status} — check the key`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  if (!Array.isArray(json.data)) throw new Error(`${provider.label} returned no model list`);
  return json.data.map((m) => m.id).filter((x): x is string => !!x);
}
