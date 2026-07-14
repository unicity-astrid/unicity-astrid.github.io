/**
 * Client-side retrieval over the complete build-time developer-guide index.
 * The default lens is deliberately search, while the opt-in local model uses
 * the same results as its grounding context.
 */

export interface Chapter {
  slug: string;
  title: string;
  part: string;
  excerpt: string;
  text: string;
  url: string;
}

let index: Chapter[] | null = null;
let loading: Promise<Chapter[]> | null = null;

export function loadIndex(): Promise<Chapter[]> {
  if (index) return Promise.resolve(index);
  if (!loading) {
    loading = fetch('/agent-index.json')
      .then((response) => {
        if (!response.ok) throw new Error(`developer guide index returned ${response.status}`);
        return response.json() as Promise<Chapter[]>;
      })
      .then((entries) => (index = entries))
      .catch((error: unknown) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

/** Term-frequency scoring with a title and part-name boost. */
export async function searchGuide(query: string, limit = 3): Promise<Chapter[]> {
  const chapters = await loadIndex();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  if (!terms.length) return [];
  const scored = chapters
    .map((chapter) => {
      const title = chapter.title.toLowerCase();
      const part = chapter.part.toLowerCase();
      const text = chapter.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 6;
        if (part.includes(term)) score += 3;
        score += Math.min(text.split(term).length - 1, 8);
      }
      return { chapter, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ chapter }) => chapter);
}

const SECTION_QUERIES: Record<string, string> = {
  hero: 'Unicity AOS product Astrid Runtime boundary',
  thesis: 'agent operating system product architecture',
  'dumb-kernel': 'kernel event bus routing sandbox',
  capsules: 'capsule anatomy composition manifest',
  layers: 'bus topics tools IPC WIT',
  capabilities: 'capability permissions grants denial',
  grow: 'build package publish capsule',
  audiences: 'uplinks integrations principals isolation',
  proof: 'security sandbox audit records Unicity Audit',
  developers: 'developer guide capsules HTTP CLI',
  start: 'get started install release',
};

export function queryForSection(id: string): string {
  return SECTION_QUERIES[id] ?? id.replace(/-/g, ' ');
}
