/**
 * Build-time book index for the agent pill: one JSON of every chapter with a
 * plain-text body for retrieval. Static output, fetched lazily by the pill
 * (never on the critical path). Grounding stays honest: the agent only ever
 * quotes what is actually in the book.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

/** Rough markdown -> plain text: enough for retrieval scoring and excerpts. */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>|-]{1,3}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const GET: APIRoute = async () => {
  const chapters = await getCollection('book');
  const index = chapters.map((c) => {
    const text = plain(c.body ?? '');
    const title =
      (c.data as { title?: string }).title ??
      (c.body ?? '').match(/^#\s+(.+)$/m)?.[1] ??
      c.id.replace(/\.md$/, '');
    return {
      slug: c.id.replace(/\.md$/, ''),
      title,
      excerpt: text.slice(0, 220),
      // Enough for grounding an answer without shipping the whole book twice.
      text: text.slice(0, 4000),
    };
  });
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json' },
  });
};
