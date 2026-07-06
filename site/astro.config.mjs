// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { posix, dirname } from 'node:path';

/**
 * Rewrite mdBook-style relative links (`./x.md`, `../part/y.md#frag`) in the
 * book/handbook collections to their site routes. The books stay verbatim in
 * their own repos; only rendered hrefs are adjusted.
 */
function rehypeMdBookLinks() {
  /** @param {any} tree @param {any} file */
  return (tree, file) => {
    const path = String(file?.path ?? '').replaceAll('\\', '/');
    const srcMarker = '/astrid-book/src/';
    const root = '/book';
    if (!path.includes(srcMarker)) return;
    const relDir = dirname(path.slice(path.indexOf(srcMarker) + srcMarker.length));

    /** @param {any} node */
    const walk = (node) => {
      if (node?.tagName === 'a' && typeof node.properties?.href === 'string') {
        const href = node.properties.href;
        if (!/^(https?:|mailto:|#|\/)/.test(href) && /\.md(#|$)/.test(href)) {
          const [target = '', frag] = href.split('#');
          const resolved = posix
            .normalize(posix.join(relDir === '.' ? '' : relDir, target))
            .replace(/\.md$/, '');
          node.properties.href = `${root}/${resolved}/${frag ? `#${frag}` : ''}`;
        }
      }
      for (const child of node?.children ?? []) walk(child);
    };
    walk(tree);
  };
}

const kernelPkg = new URL('../kernel-web/pkg/kernel_web.js', import.meta.url);
// Until the bridge crate is built, alias to a stub that throws on init so the
// page runs in its honest static mode instead of failing the build.
const kernelEntry = existsSync(kernelPkg)
  ? fileURLToPath(kernelPkg)
  : fileURLToPath(new URL('./src/scripts/kernel-stub.ts', import.meta.url));

export default defineConfig({
  // The live host — llms.txt and canonical URLs are built from this, so it
  // must be where the site actually serves.
  site: 'https://astridos.org',
  output: 'static',
  markdown: {
    shikiConfig: { theme: 'github-dark-default' },
    rehypePlugins: [rehypeMdBookLinks],
  },
  vite: {
    resolve: {
      alias: {
        // wasm-pack output of the kernel bridge crate; the site imports the
        // REAL kernel through this alias.
        'kernel-web': kernelEntry,
      },
    },
    // Let the wasm-bindgen glue fetch its .wasm relative to itself.
    assetsInclude: ['**/*.wasm'],
    optimizeDeps: {
      exclude: ['kernel-web'],
    },
  },
});
