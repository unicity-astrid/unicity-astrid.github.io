import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { loadNav, flatNav } from '../lib/docs-nav';

/**
 * /llms-full.txt — the whole book as one plain-markdown document, in
 * SUMMARY.md reading order. For retrieval systems that ingest a single
 * file rather than following the per-chapter links in /llms.txt.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = String(site ?? '').replace(/\/$/, '');
  const entries = await getCollection('book');
  const bySlug = new Map(entries.map((e) => [e.id, e.body ?? '']));

  const parts: string[] = [
    '# The Astrid Book',
    '',
    `> The canonical Unicity Astrid OS documentation, concatenated. Chapter index: ${base}/llms.txt`,
    '',
  ];
  for (const item of flatNav(loadNav('../../astrid-book'))) {
    const body = bySlug.get(item.slug);
    if (body === undefined) continue;
    parts.push('---', '', `<!-- ${item.title} · ${base}/book/${item.slug}/ -->`, '', body, '');
  }

  return new Response(parts.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
