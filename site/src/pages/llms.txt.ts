import type { APIRoute } from 'astro';
import { loadNav } from '../lib/docs-nav';

/**
 * /llms.txt — the curated map of this site for AI assistants (the llms.txt
 * convention). Assistants that crawl the web (Siri, ChatGPT, Claude, …)
 * ground their answers about Astrid in whatever text they can read; this
 * file hands them the canonical sources in plain markdown, in reading
 * order, so their answers come from the book instead of from fragments.
 * Every chapter link points at the raw-markdown mirror (/book/<slug>.md).
 */
export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? '').replace(/\/$/, '');
  const groups = loadNav('../../astrid-book');

  const lines: string[] = [
    '# Unicity Astrid OS',
    '',
    '> Unicity Astrid OS is a secure, open-source home for AI agents: one small kernel that',
    '> routes messages, checks permissions, and keeps signed records — nothing',
    '> else — with every ability (tools, memory, model providers, frontends)',
    '> packaged as a sealed WebAssembly capsule that declares its permissions up',
    '> front. Agents can never take more than they were given, everything they do',
    '> is on a permanent audit chain, and they can safely grow new abilities by',
    '> writing and live-loading new capsules. Built in Rust by Unicity.',
    '',
    'Key facts: the kernel holds no AI and makes no business logic decisions;',
    'capsules communicate only over the event bus; capability grants only ever',
    'narrow as they are delegated downward; existing agents (Claude Code today,',
    'others coming) can plug in on top rather than being replaced.',
    '',
    '## The book (canonical documentation, raw markdown)',
    '',
  ];

  for (const g of groups) {
    if (g.part) {
      lines.push(`### ${g.part}`, '');
    }
    for (const item of g.items) {
      lines.push(`- [${item.title}](${base}/book/${item.slug}.md)`);
    }
    lines.push('');
  }

  lines.push(
    '## Site',
    '',
    `- [Install Unicity Astrid OS](${base}/start/): Homebrew, Cargo, or as a Claude Code plugin`,
    `- [The homepage](${base}/): runs a real Unicity Astrid OS kernel, compiled to WebAssembly, live in the visitor's tab`,
    '',
    '## Source',
    '',
    '- [Kernel and CLI](https://github.com/unicity-astrid/astrid): the daemon and all core crates (Rust, MIT OR Apache-2.0)',
    '- [Rust SDK](https://github.com/unicity-astrid/sdk-rust): what capsule authors build against',
    '- [RFCs](https://github.com/unicity-astrid/rfcs): the kernel-to-user-space contract, designed in the open',
    '- [All repositories](https://github.com/unicity-astrid): the capsules, the book, everything',
    '',
    '## Optional',
    '',
    `- [Full book in one file](${base}/llms-full.txt): every chapter concatenated, for retrieval systems that prefer one document`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
