/**
 * The docs lens: client-side retrieval over the build-time book index
 * (/agent-index.json). Used two ways: standalone (the pill's default,
 * honest "docs lens" mode: it finds chapters, it does not pretend to think)
 * and as grounding for the opt-in local LLM.
 */

export interface Chapter {
  slug: string;
  title: string;
  excerpt: string;
  text: string;
}

let index: Chapter[] | null = null;
let loading: Promise<Chapter[]> | null = null;

export function loadIndex(): Promise<Chapter[]> {
  if (index) return Promise.resolve(index);
  loading ??= fetch('/agent-index.json')
    .then((r) => r.json() as Promise<Chapter[]>)
    .then((i) => (index = i));
  return loading;
}

/** Term-frequency scoring with a title boost. Simple, transparent, local. */
export async function searchBook(query: string, limit = 3): Promise<Chapter[]> {
  const chapters = await loadIndex();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return [];
  const scored = chapters
    .map((c) => {
      const title = c.title.toLowerCase();
      const text = c.text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 6;
        score += Math.min(text.split(t).length - 1, 8);
      }
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.c);
}

/** What the reader is looking at -> what to search the book for. */
const SECTION_QUERIES: Record<string, string> = {
  hero: 'introduction what astrid is',
  thesis: 'introduction operating system for agents',
  'dumb-kernel': 'kernel event bus routing dumb',
  capsules: 'capsule model designing capsules',
  layers: 'bus topics tools ipc interceptor',
  capabilities: 'capability tokens permission grant deny',
  grow: 'self extension build install skills',
  audiences: 'uplinks frontends principals isolation',
  proof: 'security sandbox audit chain',
  books: 'introduction',
  start: 'getting started install',
};

export function queryForSection(id: string): string {
  return SECTION_QUERIES[id] ?? id.replace(/-/g, ' ');
}
