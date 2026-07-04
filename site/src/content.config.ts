import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The book renders verbatim from its own repo (the site never copies or
 * rewrites content): astrid-book lives as a sibling of astrid-web in the
 * workspace. SUMMARY.md is nav metadata, not a page.
 */
const book = defineCollection({
  loader: glob({ base: '../../astrid-book/src', pattern: ['**/*.md', '!SUMMARY.md'] }),
});

export const collections = { book };
