// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const kernelPkg = new URL('../kernel-web/pkg/kernel_web.js', import.meta.url);
// Until the bridge crate is built, alias to a stub that throws on init so the
// page runs in its honest static mode instead of failing the build.
const kernelEntry = existsSync(kernelPkg)
  ? fileURLToPath(kernelPkg)
  : fileURLToPath(new URL('./src/scripts/kernel-stub.ts', import.meta.url));

export default defineConfig({
  // The live host — llms.txt and canonical URLs are built from this, so it
  // must be where the site actually serves.
  site: 'https://aos.unicity.ai',
  output: 'static',
  markdown: { shikiConfig: { theme: 'github-dark-default' } },
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
