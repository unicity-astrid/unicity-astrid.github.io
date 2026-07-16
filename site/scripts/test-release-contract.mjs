import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [start, home, getStarted, integrations, llms, publicInstaller, builtInstaller] =
  await Promise.all([
    read('dist/start/index.html'),
    read('dist/index.html'),
    read('dist/developers/get-started/index.html'),
    read('dist/developers/integrations/index.html'),
    read('dist/llms.txt'),
    read('public/install.sh'),
    read('dist/install.sh'),
  ]);

const copyButtons = start.match(/<button class="mono start-copy"[^>]*>/g) ?? [];
assert.equal(copyButtons.length, 7, 'expected stable, dev, nightly, Homebrew, and three Oracle controls');
for (const button of copyButtons) {
  assert.match(button, / disabled(?:\s|>)/, 'every staged install control must be disabled');
}

for (const expected of [
  '--channel dev',
  '--channel nightly',
  'stable closed',
  'dev closed',
  'nightly closed',
  'aos@aos-oracles',
]) {
  assert.ok(start.includes(expected), `rendered install page is missing ${expected}`);
}

for (const forbidden of ['astrid@astrid-oracles', 'astrid@unicity-aos/oracles']) {
  assert.ok(!start.includes(forbidden), `rendered install page retained ${forbidden}`);
  assert.ok(!integrations.includes(forbidden), `integration guide retained ${forbidden}`);
}

assert.ok(!home.includes('<button class="mono hero-copy"'), 'staged home page exposed an installer copy action');
assert.ok(getStarted.includes('not published'), 'get-started guide must state that channels are unavailable');
assert.ok(llms.includes('stable, dev, nightly, Homebrew, and AOS Oracle installs are closed'));
assert.equal(builtInstaller, publicInstaller, 'Astro changed the mirrored installer bytes');

console.log('release/install surfaces are staged and fail closed');
