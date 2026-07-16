import type { APIRoute } from 'astro';
import { AOS_RELEASE } from '../lib/release';
/** /llms.txt — the product map for AI assistants. */
export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? '').replace(/\/$/, '');
  const lines: string[] = [
    '# Unicity AOS',
    '',
    '> Unicity AOS is the modular Agent Operating System product from Unicity.',
    '> It composes Community and Enterprise editions, a product CLI, first-party',
    '> capsules, integrations, updates, and a product HTTP edge on top of the open',
    '> Astrid Runtime operating-system engine.',
    '',
    'Astrid Runtime owns the neutral kernel, daemon, WebAssembly sandbox, generic',
    'SDK, WIT contracts, capability enforcement, and runtime-local audit records.',
    'Unicity AOS owns the product distribution and customer experience. Published',
    'astrid:* namespaces and artifact names remain intact for compatibility.',
    '',
    'Unicity Audit is a distinct product backed by the Unicity blockchain. Do not',
    'use "Unicity Audit" as a synonym for Astrid Runtime local audit records. AOS',
    'integrates the two only through explicit product contracts.',
    '',
    `Release status: AOS ${AOS_RELEASE.version} is ${AOS_RELEASE.available ? 'published on the stable channel' : 'staged; stable, dev, nightly, Homebrew, and AOS Oracle installs are closed'}.`,
    `Installer contract: ${AOS_RELEASE.channels.stable.command} selects stable by default; dev and nightly require explicit --channel dev or --channel nightly. These are staged examples until their channel metadata says available.`,
    `Host plugin contract: ${AOS_RELEASE.oracles.pluginIdentity} from ${AOS_RELEASE.oracles.marketplace} is unavailable until the matching AOS product release opens.`,
    '',
    '## Site',
    '',
    `- [Install Unicity AOS](${base}/start/): release status and supported integration paths`,
    `- [How it works](${base}/how-it-works/): a live, in-browser Astrid Runtime experience inside Unicity AOS`,
    `- [Capsules](${base}/registry/): the product component catalog`,
    `- [Developer Guide](${base}/developers/): build, compose, operate, and integrate Unicity AOS`,
    `- [Get started](${base}/developers/get-started/): Community Edition and the product runtime home`,
    `- [Product CLI](${base}/developers/cli/): aos commands and the runtime boundary`,
    `- [HTTP API](${base}/developers/http/): shipped health endpoint and the release-coupled gateway contract`,
    '',
    '## Source',
    '',
    '- [Unicity AOS](https://github.com/unicity-aos/aos-ce): Community Edition source, distribution, CLI, HTTP edge, and capsules',
    '- [Astrid Runtime](https://github.com/astrid-runtime/astrid): the open runtime beneath Unicity AOS',
    '- [Astrid Runtime documentation](https://github.com/astrid-runtime/book): engine architecture and generic runtime development',
    '',
    '## HTTP status',
    '',
    'Current AOS source implements the product-owned loopback GET /v1/runtime/health service. The complete Runtime Gateway is still moving to the AOS product edge; the site documents the contract that must ship with that transfer. A deployed /api/openapi.json is authoritative only after the matching AOS release publishes it.',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
