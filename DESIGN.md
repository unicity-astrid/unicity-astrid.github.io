# Unicity AOS website design contract

## Product boundary

Unicity AOS is the product and distribution. Astrid Runtime is the neutral,
open operating-system engine beneath it. Product pages lead with AOS; technical
runtime identifiers remain Astrid where compatibility, source provenance, WIT
namespaces, ABI names, crate names, or signed artifacts require it.

Never describe Astrid as the entire AOS product. Never describe AOS as merely a
kernel. The useful shorthand is:

> Unicity AOS composes a complete agent operating-system product on top of
> Astrid Runtime.

Unicity Audit is the blockchain-backed Unicity product. Astrid's runtime-local
audit records are a separate mechanism. Copy may describe an explicit
integration, but it must never merge the two names.

## Visual system

The product uses Unicity's near-black ground, white typography, and orange as
the only directional accent. Anton carries large product statements; Inter is
the reading face; Geist Mono marks commands, status, and machine facts. The
vertical runtime spine is an architectural motif: a quiet engine underneath a
larger, modular product.

All interactive claims are literal. When the browser kernel is unavailable,
the site says so and remains useful as a static product site. Concept pages such
as the registry and builder must identify themselves as previews and must not
present disabled controls as shipped behavior.

## Information architecture

- `/` is the product narrative.
- `/how-it-works/` explains the AOS/Astrid composition.
- `/developers/` is a chaptered, Book-style developer manual.
- `/registry/` and `/build/` are explicitly marked concept previews.
- `/start/` is the single release-status and installation surface.
- `/llms.txt` describes the same product boundary for automated readers.

The former embedded Astrid Book is not part of this product site. Old `/book`
traffic must resolve to the AOS developer guide; runtime documentation links to
the neutral Astrid project.

## Release truth

`site/src/lib/release.ts` is the source of truth for product version and
installer availability. The public command is:

```sh
curl -fsSL https://aos.unicity.ai/install.sh | sh
```

The UI may enable copying and call that command supported only after the same
AOS version has published CLI and embedded-runtime archives, checksums,
signatures, and installer verification. Homebrew, Cargo, or plugin-only paths
must not be advertised as product installation unless they install the actual
AOS product.

## Quality bar

- `npm run check` and `npm run build` both pass in CI.
- Navigation, the HUD, the developer guide, and the resident docs lens work by
  keyboard and at narrow widths.
- Markdown tables scroll within the reading column rather than widening it.
- The generated guide index contains full text, excerpts, and valid
  `/developers/...` destinations.
- Deleted Book routes and the legacy expanded LLM index have compatibility
  destinations.
- Claims about HTTP ownership are release-coupled until the complete gateway
  transfer lands in AOS.
