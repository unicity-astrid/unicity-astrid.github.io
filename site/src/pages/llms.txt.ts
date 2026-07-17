import type { APIRoute } from 'astro';
import { AOS_RELEASE } from '../lib/release';
/** /llms.txt — the product map for AI assistants. */
export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? '').replace(/\/$/, '');
  const lines: string[] = [
    '# Unicity AOS',
    '',
    '> Unicity AOS lets AI agents safely extend themselves.',
    '> Claude Code, Grok Build, and Codex can identify a missing ability, build it',
    '> as a capsule, request approval, install it live, and use it without gaining',
    '> unrestricted access to the machine.',
    '',
    'The operator supplies the goal. The agent can determine which capability is',
    'missing and build it. Every new capsule declares its permissions before the',
    'operator approves installation.',
    '',
    '> Astrid is the secure engine underneath: it runs isolated capsules, grants',
    '> only explicit capabilities, and records what the system enforced.',
    '',
    'Unicity AOS is the product people install and operate. It includes the aos CLI,',
    'Community Edition composition, capsules, integrations, updates, and HTTP API.',
    'Each AOS release bundles one exact, tested Astrid Runtime release.',
    '',
    'Unicity Audit is a distinct product backed by the Unicity blockchain. Do not',
    'use "Unicity Audit" as a synonym for Astrid Runtime local audit records. AOS',
    'integrates the two only through explicit product contracts.',
    '',
    `Installer: ${AOS_RELEASE.channels.stable.command} selects stable by default; dev and nightly require explicit --channel dev or --channel nightly.`,
    'Unavailable channels fail closed instead of falling back to another release.',
    `Host plugin contract: ${AOS_RELEASE.oracles.pluginIdentity} from ${AOS_RELEASE.oracles.marketplace} is unavailable until the matching AOS product release opens.`,
    '',
    '## Site',
    '',
    `- [Install Unicity AOS](${base}/start/): installation channels and supported host integrations`,
    `- [How it works](${base}/how-it-works/): a live, in-browser Astrid Runtime experience inside Unicity AOS`,
    `- [Capsules](${base}/registry/): the product component catalog`,
    `- [Developer Guide](${base}/developers/): build, compose, operate, and integrate Unicity AOS`,
    `- [Get started](${base}/developers/get-started/): Community Edition and the product runtime home`,
    `- [Product CLI](${base}/developers/cli/): AOS commands and inherited engine operations`,
    `- [HTTP API](${base}/developers/http/): health, authentication, administration, and streaming`,
    '',
    '## Source',
    '',
    '- [Unicity AOS](https://github.com/unicity-aos/aos-ce): Community Edition source, distribution, CLI, HTTP edge, and capsules',
    '- [Astrid Runtime](https://github.com/astrid-runtime/astrid): the open runtime beneath Unicity AOS',
    '- [Astrid Runtime documentation](https://github.com/astrid-runtime/book): engine architecture and generic runtime development',
    '',
    '## HTTP status',
    '',
    'AOS exposes GET /v1/runtime/health for local readiness and a broader authenticated product gateway. The /api/openapi.json document served by a deployed release is authoritative for that release.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
