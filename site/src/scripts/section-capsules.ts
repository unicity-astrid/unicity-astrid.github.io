/**
 * Section capsules: the page's interactive behaviour, moved into REAL Astrid
 * capsules (Rust, astrid-sdk, wasm32-unknown-unknown, jco-transpiled) running
 * against the in-tab kernel via the live host adapter.
 *
 * The page is the uplink: it publishes input events (clock ticks, the text
 * you type) and delivers each matching bus event to the capsule's genuine
 * `astridHookTrigger` export, exactly the entrypoint the native host drives
 * for hook fan-out. Capsule publishes go through astrid:ipc/host to the real
 * bus, attributed to the capsule.
 *
 * Install mints a real capability token for the capsule's input topic and
 * checks it (both on the audit chain); uninstall revokes it and stops
 * delivery. Uninstalling a capsule genuinely disables the page element it
 * powers: nothing else produces those events.
 */

import type { AstridBridge } from './kernel';
import { createLiveHost, type HostCall } from './showcase-host';

export interface SectionCapsuleDef {
  name: string;
  /** astridHookTrigger action string (the page-side contract). */
  action: string;
  /** Exact input topic the page delivers to the capsule. */
  input: string;
  /** Topics it publishes (display only; attribution is enforced by source). */
  outputs: string[];
  blurb: string;
}

export const SECTION_CAPSULES: SectionCapsuleDef[] = [
  {
    name: 'site-pulse',
    action: 'handle_tick',
    input: 'site.v1.clock.tick',
    outputs: ['site.v1.demo.route'],
    blurb: 'routes the homepage pulses; uninstall it and they stop',
  },
  {
    name: 'site-guard',
    action: 'handle_input',
    input: 'site.v1.input.text',
    outputs: ['site.v1.guarded.text', 'site.v1.guard.blocked'],
    blurb: 'screens your input before anything else sees it',
  },
  {
    name: 'site-echo',
    action: 'handle_guarded',
    input: 'site.v1.guarded.text',
    outputs: ['site.v1.echo.reply'],
    blurb: 'answers, but only ever sees what the guard passed through',
  },
];

export type CapsuleState = 'unavailable' | 'installed' | 'uninstalled' | 'error';

interface Runtime {
  root: { astridHookTrigger(action: string, payload: Uint8Array): unknown } | null;
  state: CapsuleState;
  tokenId: string | null;
  journal: HostCall[];
  wired: boolean;
}

const runtimes = new Map<string, Runtime>();
type Listener = () => void;
const listeners = new Set<Listener>();
let bridgeRef: AstridBridge | null = null;

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to install-state changes; fires immediately. */
export function onSectionCapsules(l: Listener): () => void {
  listeners.add(l);
  l();
  return () => listeners.delete(l);
}

export function capsuleState(name: string): CapsuleState {
  return runtimes.get(name)?.state ?? 'unavailable';
}

// The transpiled modules land here at build time (site-capsules/build.sh).
// import.meta.glob resolves to {} until they exist, so the site builds and
// degrades honestly without them.
const MODULES = import.meta.glob('../capsules/*/*.component.js');

function moduleLoaderFor(name: string): (() => Promise<unknown>) | null {
  for (const [path, load] of Object.entries(MODULES)) {
    if (path.includes(`/capsules/${name}/`)) return load as () => Promise<unknown>;
  }
  return null;
}

const enc = new TextEncoder();

/**
 * Boot the section-capsule system: instantiate and install every capsule
 * whose transpiled module shipped with this build, and wire delivery.
 */
export async function bootSectionCapsules(bridge: AstridBridge): Promise<void> {
  bridgeRef = bridge;
  for (const def of SECTION_CAPSULES) {
    const rt: Runtime = runtimes.get(def.name) ?? {
      root: null,
      state: 'unavailable',
      tokenId: null,
      journal: [],
      wired: false,
    };
    runtimes.set(def.name, rt);
    const load = moduleLoaderFor(def.name);
    if (!load) continue; // no transpiled module in this build: stays unavailable

    try {
      const mod = (await load()) as {
        instantiate(
          getCoreModule: (path: string) => Promise<WebAssembly.Module>,
          imports: unknown,
        ): Promise<unknown> | unknown;
      };
      const host = createLiveHost(bridge, {
        source: `capsule-${def.name}`,
        kvNs: `site.${def.name}`,
      });
      rt.journal = host.journal;
      const getCoreModule = async (path: string) =>
        WebAssembly.compile(await (await fetch(`/capsules/${def.name}/${path}`)).arrayBuffer());
      const root = (await mod.instantiate(getCoreModule, host.imports as never)) as Runtime['root'] & {
        astridInstall?(): void;
      };
      root?.astridInstall?.();
      rt.root = root;

      // Delivery gate: one real subscription per capsule, forwarding only
      // while installed. The grant/revoke pair is what flips `state`.
      if (!rt.wired) {
        rt.wired = true;
        bridge.subscribe(def.input, (_topic, json) => {
          const r = runtimes.get(def.name);
          if (r?.state !== 'installed' || !r.root) return;
          try {
            r.root.astridHookTrigger(def.action, enc.encode(json));
          } catch (err) {
            console.warn(`[astrid] ${def.name} hook failed:`, err);
          }
        });
      }

      await installCapsule(def.name);
    } catch (err) {
      console.warn(`[astrid] ${def.name} failed to load:`, err);
      rt.state = 'error';
    }
  }
  notify();
}

/** Grant + check the input-topic capability (both audited) and enable delivery. */
export async function installCapsule(name: string): Promise<void> {
  const def = SECTION_CAPSULES.find((d) => d.name === name);
  const rt = runtimes.get(name);
  if (!def || !rt?.root || !bridgeRef) return;
  try {
    rt.tokenId = await bridgeRef.grant(`capsule-${name}`, `topic:${def.input}`, 'read');
    const ok = await bridgeRef.check(`capsule-${name}`, `topic:${def.input}`, 'read');
    rt.state = ok ? 'installed' : 'error';
  } catch (err) {
    console.warn(`[astrid] install ${name} failed:`, err);
    rt.state = 'error';
  }
  notify();
}

/** Revoke the capability (audited) and stop delivery. */
export async function uninstallCapsule(name: string): Promise<void> {
  const rt = runtimes.get(name);
  if (!rt || !bridgeRef) return;
  rt.state = 'uninstalled';
  notify();
  if (rt.tokenId && bridgeRef.revoke) {
    try {
      await bridgeRef.revoke(rt.tokenId);
    } catch (err) {
      console.warn(`[astrid] revoke for ${name} failed:`, err);
    }
    rt.tokenId = null;
  }
}

export async function toggleCapsule(name: string): Promise<void> {
  const state = capsuleState(name);
  if (state === 'installed') await uninstallCapsule(name);
  else if (state === 'uninstalled') await installCapsule(name);
}
