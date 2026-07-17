const installer = 'curl -fsSL https://aos.unicity.ai/install.sh | sh';
const channelAvailability = {
  stable: true,
  dev: false,
  nightly: false,
} as const;
const homebrewAvailable = true;
const oraclesAvailable = true;
export const AOS_RELEASE = {
  version: '2026.1.1',
  status: 'released',
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
    pluginIdentity: 'unicity-aos@unicity-aos-oracles',
    marketplace: 'https://github.com/unicity-aos/oracles',
    commands: {
      claude:
        `${installer} -s -- --host claude`,
      grok:
        `${installer} -s -- --host grok`,
      codex:
        `${installer} -s -- --host codex`,
    },
  },
} as const;
