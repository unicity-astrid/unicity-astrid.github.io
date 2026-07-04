/**
 * Guest capsule runtime for the playground.
 *
 * The visitor's code runs in a dedicated Web Worker: no DOM, no page state,
 * terminated on uninstall. Every host power the guest touches goes over a
 * postMessage RPC to the main thread, which forwards it to the kernel-web
 * bridge's MEDIATED methods (guestKvGet/guestKvSet/guestPublish). Those
 * methods check the real CapabilityStore before acting and stamp every
 * decision on the real audit chain, so an un-granted call rejects here with
 * the kernel's own denial, not a UI simulation.
 *
 * Honesty note: real capsules ship as WebAssembly behind the kernel sandbox.
 * This worker is an authoring convenience with the same capability gate; the
 * page says so in as many words.
 */

import type { AstridBridge } from './kernel';

export interface GuestManifest {
  /** [a-z0-9-]{1,32}; principal becomes `guest-<name>`, KV ns `guest.<name>`. */
  name: string;
  /** Real TopicMatcher patterns (no `**`; trailing `.*` = subtree). */
  subscriptions: string[];
  caps: {
    kvRead: boolean;
    kvWrite: boolean;
    /** Exact topics the guest may publish to (one grant per topic). */
    publishTopics: string[];
  };
}

export interface GuestLogEntry {
  at: Date;
  kind: 'lifecycle' | 'log' | 'host' | 'deny' | 'error';
  text: string;
}

export interface GuestHandle {
  principal: string;
  uninstall(): Promise<void>;
}

const NAME_RE = /^[a-z0-9-]{1,32}$/;

/** The harness injected ahead of the visitor's source inside the worker. */
const HARNESS = String.raw`
let __seq = 0;
const __pending = new Map();
function __rpc(fn, args) {
  return new Promise((resolve, reject) => {
    const id = __seq++;
    __pending.set(id, { resolve, reject });
    postMessage({ type: 'rpc', id, fn, args });
  });
}
const astrid = {
  kv: {
    get: (key) => __rpc('kvGet', [String(key)]),
    set: (key, val) => __rpc('kvSet', [String(key), String(val)]),
  },
  publish: (topic, data) => __rpc('publish', [String(topic), JSON.stringify(data ?? null)]),
  log: (msg) => { postMessage({ type: 'log', text: String(msg) }); },
};
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'rpc-result') {
    const p = __pending.get(m.id);
    if (!p) return;
    __pending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(m.error));
  } else if (m.type === 'event') {
    try {
      if (typeof on_event === 'function') {
        Promise.resolve(on_event(m.topic, m.payload)).catch((err) => {
          postMessage({ type: 'guest-error', text: String(err && err.message || err) });
        });
      }
    } catch (err) {
      postMessage({ type: 'guest-error', text: String(err && err.message || err) });
    }
  }
};
`;

/**
 * Grant the ticked capabilities, spin up the worker, and wire subscriptions.
 * Returns a handle whose `uninstall` terminates the worker and (when the
 * bridge supports it) revokes the granted tokens.
 */
export async function installGuest(
  bridge: AstridBridge,
  manifest: GuestManifest,
  source: string,
  onLog: (entry: GuestLogEntry) => void,
): Promise<GuestHandle> {
  if (!bridge.guestKvGet || !bridge.guestKvSet || !bridge.guestPublish) {
    throw new Error('kernel bridge predates the playground surface; rebuild kernel-web');
  }
  if (!NAME_RE.test(manifest.name)) {
    throw new Error('capsule name must be 1-32 chars of a-z, 0-9, -');
  }

  const principal = `guest-${manifest.name}`;
  const ns = `guest.${manifest.name}`;
  const log = (kind: GuestLogEntry['kind'], text: string) =>
    onLog({ at: new Date(), kind, text });

  // Mint the real grants for exactly the ticked boxes. Everything unticked
  // stays ungranted, so the mediated calls below deny it for real.
  const tokenIds: string[] = [];
  if (manifest.caps.kvRead) {
    tokenIds.push(await bridge.grant(principal, `kv:${ns}`, 'read'));
    log('lifecycle', `granted read on kv:${ns}`);
  }
  if (manifest.caps.kvWrite) {
    tokenIds.push(await bridge.grant(principal, `kv:${ns}`, 'write'));
    log('lifecycle', `granted write on kv:${ns}`);
  }
  for (const topic of manifest.caps.publishTopics) {
    tokenIds.push(await bridge.grant(principal, `topic:${topic}`, 'write'));
    log('lifecycle', `granted write on topic:${topic}`);
  }

  const blob = new Blob(
    [HARNESS, '\n// ---- visitor capsule ----\n', source, '\npostMessage({ type: "ready" });\n'],
    { type: 'text/javascript' },
  );
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url, { name: principal });
  URL.revokeObjectURL(url);

  let disposed = false;

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (disposed) return;
    switch (m.type) {
      case 'ready':
        log('lifecycle', `${principal} installed and listening`);
        break;
      case 'log':
        log('log', m.text);
        break;
      case 'guest-error':
        log('error', `on_event threw: ${m.text}`);
        break;
      case 'rpc':
        void handleRpc(m.id, m.fn, m.args);
        break;
    }
  };
  worker.onerror = (e) => {
    if (!disposed) log('error', `worker error: ${e.message}`);
  };

  async function handleRpc(id: number, fn: string, args: string[]): Promise<void> {
    try {
      let value: unknown;
      switch (fn) {
        case 'kvGet':
          value = await bridge.guestKvGet!(principal, ns, args[0]!);
          log('host', `kv get ${args[0]} -> ${value === undefined ? '(none)' : 'ok'}`);
          break;
        case 'kvSet':
          await bridge.guestKvSet!(principal, ns, args[0]!, args[1]!);
          log('host', `kv set ${args[0]}`);
          break;
        case 'publish':
          await bridge.guestPublish!(principal, args[0]!, args[1]!);
          log('host', `publish ${args[0]}`);
          break;
        default:
          throw new Error(`unknown host fn ${fn}`);
      }
      if (!disposed) worker.postMessage({ type: 'rpc-result', id, ok: true, value });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A denial from the mediated bridge is the demo working, not a bug.
      log('deny', msg);
      if (!disposed) worker.postMessage({ type: 'rpc-result', id, ok: false, error: msg });
    }
  }

  // Wire the manifest subscriptions to the real bus. bridge.subscribe pumps
  // live for the page's lifetime; the disposed flag stops forwarding after
  // uninstall (delivery, not the pump, is what the guest loses).
  for (const pattern of manifest.subscriptions) {
    bridge.subscribe(pattern, (topic, json) => {
      if (disposed) return;
      let payload: unknown = null;
      try {
        payload = JSON.parse(json);
      } catch {
        payload = json;
      }
      worker.postMessage({ type: 'event', topic, payload });
    });
    log('lifecycle', `subscribed to ${pattern}`);
  }

  return {
    principal,
    async uninstall() {
      disposed = true;
      worker.terminate();
      if (bridge.revoke) {
        for (const id of tokenIds) {
          try {
            await bridge.revoke(id);
          } catch (err) {
            console.warn('[astrid] revoke failed:', err);
          }
        }
        log('lifecycle', `${principal} uninstalled, ${tokenIds.length} grant(s) revoked`);
      } else {
        log('lifecycle', `${principal} uninstalled (grants expire with the session)`);
      }
    },
  };
}
