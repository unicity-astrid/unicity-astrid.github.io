# Unicity AOS website

Product website and developer documentation for **Unicity AOS**, the modular
Agent Operating System from Unicity. The site explains the product distribution
while preserving the boundary to [Astrid Runtime](https://github.com/astrid-runtime/astrid),
the open operating-system engine beneath it.

The production hostname is [aos.unicity.ai](https://aos.unicity.ai/). Until the
first signed AOS product release is published, the install surface visibly marks
stable, dev, nightly, Homebrew, and AOS Oracle channels as staged and keeps every
copy action disabled.

## Repository layout

| Path | Purpose |
| --- | --- |
| `site/` | Astro website, developer guide, local docs lens, and product pages |
| `kernel-web/` | Browser bridge for the real Astrid kernel used by interactive explanations |
| `site-capsules/` | WebAssembly components used only by the in-browser experience |
| `kernel-smoke/` and `spike/` | Runtime portability and component-model probes |
| `notes/` and `DESIGN.md` | Implementation notes and the current product-site contract |

## Develop

The website requires Node.js 22.12.0 or newer.

```sh
cd site
npm ci
npm run check
npm run build
npm run dev
```

Both `check` and `build` are release gates. The product release integration is
centralized in `site/src/lib/release.ts`; `available` may become `true` only
after matching AOS artifacts, checksums, signatures, and installer assets exist.

The default installer channel is stable. Development and nightly channels are
always explicit (`--channel dev` and `--channel nightly`) and never fall back to
stable. The commands are documentation only while their channel metadata is
unavailable.

`site/public/install.sh` is a byte-for-byte mirror of the canonical `aos-ce`
installer. Pages CI records the exact source commit in
`AOS_INSTALLER_SOURCE_COMMIT` and compares both source and built copies. Update
that commit and the mirror together only after the canonical installer contract
has landed.

Community Edition source lives in
[unicity-aos/aos-ce](https://github.com/unicity-aos/aos-ce).
