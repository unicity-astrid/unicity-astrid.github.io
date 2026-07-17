const installer = 'curl -fsSL https://aos.unicity.ai/install.sh | sh';
const channelAvailability = {
  stable: false,
  dev: false,
  nightly: false,
} as const;
const homebrewAvailable = false;
const oraclesAvailable = false;

/**
 * Product release metadata has one owner. Every public install surface must
 * derive its enabled state and command from this object. A channel becomes
 * available only after its signed AOS bundle and channel metadata have been
 * published and verified. The CLI, embedded runtime, BLAKE3 and compatibility
 * digest manifests, Sigstore bundles, and installer must share one published
 * version. Oracle plugins remain closed until the matching base product release
 * is available.
 */
export const AOS_RELEASE = {
  version: '2026.1.0',
  status: 'staged',
  available: channelAvailability.stable,
  defaultChannel: 'stable',
  installCommand: installer,
  repository: 'https://github.com/unicity-aos/aos-ce',
  channels: {
    stable: {
      label: 'Stable',
      available: channelAvailability.stable,
      command: installer,
      note: 'Default channel. Resolves only an approved signed stable AOS release.',
    },
    dev: {
      label: 'Dev',
      available: channelAvailability.dev,
      command: `${installer} -s -- --channel dev`,
      note: 'Explicit development channel. No development release is published yet.',
    },
    nightly: {
      label: 'Nightly',
      available: channelAvailability.nightly,
      command: `${installer} -s -- --channel nightly`,
      note: 'Explicit nightly channel. No nightly release is published yet.',
    },
  },
  homebrew: {
    available: homebrewAvailable,
    command: 'brew install unicity-aos/tap/aos',
  },
  oracles: {
    available: oraclesAvailable,
    pluginIdentity: 'aos@aos-oracles',
    marketplace: 'https://github.com/unicity-aos/oracles',
    commands: {
      claude:
        'claude plugin marketplace add unicity-aos/oracles && claude plugin install aos@aos-oracles',
      grok:
        'grok plugin marketplace add unicity-aos/oracles && grok plugin install aos@aos-oracles --trust',
      codex:
        'codex plugin marketplace add unicity-aos/oracles && codex plugin add aos@aos-oracles',
    },
  },
} as const;
