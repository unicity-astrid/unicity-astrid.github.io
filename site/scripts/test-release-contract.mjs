import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const [
  start,
  home,
  developers,
  getStarted,
  integrations,
  llms,
  publicInstaller,
  builtInstaller,
  heroSource,
  capsuleRingSource,
  baseStyles,
  agentMarkSource,
] =
  await Promise.all([
    read('dist/start/index.html'),
    read('dist/index.html'),
    read('dist/developers/index.html'),
    read('dist/developers/get-started/index.html'),
    read('dist/developers/integrations/index.html'),
    read('dist/llms.txt'),
    read('public/install.sh'),
    read('dist/install.sh'),
    read('src/components/Hero.astro'),
    read('src/components/CapsuleRing.astro'),
    read('src/styles/base.css'),
    read('src/components/AgentMark.astro'),
  ]);

const copyButtons = start.match(/<button class="mono start-copy"[^>]*>/g) ?? [];
assert.equal(copyButtons.length, 7, 'expected stable, dev, nightly, Homebrew, and three Oracle controls');
for (const button of copyButtons) {
  assert.match(button, / disabled(?:\s|>)/, 'every staged install control must be disabled');
}

for (const expected of [
  '--channel dev',
  '--channel nightly',
  'coming soon',
  'aos@aos-oracles',
]) {
  assert.ok(start.includes(expected), `rendered install page is missing ${expected}`);
}

for (const forbidden of ['astrid@astrid-oracles', 'astrid@unicity-aos/oracles']) {
  assert.ok(!start.includes(forbidden), `rendered install page retained ${forbidden}`);
  assert.ok(!integrations.includes(forbidden), `integration guide retained ${forbidden}`);
}

assert.ok(!home.includes('<button class="mono hero-copy"'), 'staged home page exposed an installer copy action');
assert.ok(!home.includes('Install options'), 'home page retained the redundant hero CTA row');
assert.ok(!home.includes('class="home-next'), 'home page retained the redundant next-step cards');
assert.ok(home.includes('You give it the goal'), 'home page does not lead with the user goal');
assert.ok(home.includes('It builds the missing ability'), 'home page does not lead with safe self-extension');
assert.ok(home.includes('It knows what to build because it knows what you want'), 'home page does not explain goal-driven extension');
for (const agent of ['Claude Code', 'Grok Build', 'Codex']) {
  assert.ok(home.includes(agent), `home page does not show ${agent} compatibility`);
}
assert.ok(agentMarkSource.includes("grok.svg?raw"), 'Grok Build still uses a text stand-in instead of its mark');
assert.ok(home.includes('<title>Grok</title>'), 'rendered home page is missing the Grok mark');
assert.ok(home.includes('The agents have opinions'), 'home page is missing the agent response section');
assert.ok(home.includes('network: status.company.com, api.github.com'), 'home page is missing the concrete self-extension example');
assert.ok(home.includes('Free to use. One command.'), 'home page does not make the free install clear');
assert.ok(home.includes('No plugin hunting. No restart. No unrestricted machine access.'), 'home page is missing the fast safety payoff');
assert.ok(home.includes('Inspect install.sh'), 'home page does not expose the installer for inspection');
assert.ok(!home.includes('Astrid Runtime'), 'home page should remain product-first');
assert.ok(!heroSource.includes('hero-copy-opacity'), 'hero source retained the copy opacity fade');
assert.ok(!capsuleRingSource.includes('--hero-copy-opacity'), 'hero scroll driver retained the copy opacity fade');
assert.ok(capsuleRingSource.includes('-8 * exit'), 'hero scroll driver does not move the copy upward');
assert.ok(baseStyles.includes('scroll-behavior: smooth'), 'site does not enable native smooth scrolling');
assert.ok(baseStyles.includes('scroll-padding-top:'), 'smooth anchor targets can hide beneath fixed navigation');
assert.ok(!developers.includes('Redirecting'), 'developer root rendered a visible redirect page');
assert.match(developers, /<details class="docs-drawer"[^>]*>/, 'developer guide is missing its collapsed mobile chapter drawer');
assert.doesNotMatch(developers, /<details class="docs-drawer"[^>]*\sopen(?:\s|>)/, 'mobile chapter drawer should be collapsed by default');
assert.ok(developers.includes('>Overview</strong>'), 'mobile chapter drawer does not identify the current chapter');
assert.ok(developers.includes('aria-label="Unicity AOS Developer Guide chapters"'), 'mobile chapter drawer does not expose chapter navigation');
assert.ok(developers.includes('Astrid is the secure engine inside Unicity AOS'));
assert.ok(!developers.includes('What stays with Astrid Runtime'));
assert.ok(!home.includes("curl --proto '=https'"), 'public install command is unnecessarily verbose');
assert.ok(getStarted.includes('must stop without installing'), 'get-started guide must document fail-closed channels');
assert.ok(llms.includes('Unavailable channels fail closed'));
assert.equal(builtInstaller, publicInstaller, 'Astro changed the mirrored installer bytes');

const generatedRoot = new URL('../dist/', import.meta.url);
const generatedTextFiles = (await readdir(generatedRoot, { recursive: true }))
  .filter((path) => /\.(?:html|js|txt)$/.test(path));
for (const path of generatedTextFiles) {
  const contents = await readFile(new URL(path, generatedRoot), 'utf8');
  assert.ok(!contents.includes('—'), `${path} contains an em dash`);
}

console.log('release/install surfaces are staged and fail closed');
