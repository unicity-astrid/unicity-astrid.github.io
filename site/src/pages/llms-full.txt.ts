import type { APIRoute } from 'astro';

/** Compatibility endpoint for clients that bookmarked the former expanded index. */
export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? '').replace(/\/$/, '');
  return new Response(
    [
      '# Unicity AOS documentation index moved',
      '',
      `Use ${base}/llms.txt for the maintained product map.`,
      `Use ${base}/agent-index.json for the complete developer-guide search corpus.`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
};
