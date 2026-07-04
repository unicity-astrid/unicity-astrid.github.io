/**
 * Live `astrid:*` host imports for the jco-transpiled prompt-builder capsule.
 *
 * The spike proved the component needs exactly three host interfaces
 * (astrid:ipc/host, astrid:kv/host, astrid:sys/host). The spike stubbed them;
 * this module wires them to the REAL in-tab kernel through kernel-web's
 * synchronous shims: publishes land on the real EventBus (attributed to the
 * capsule), KV reads and writes hit the real kernel store, and `recv` drains
 * a real bus subscription queue. jco host calls are synchronous, which is
 * why the bridge exposes hostPublish/hostKvGetSync/hostKvSetSync/
 * hostSubscribeQueue instead of the async surface the rest of the site uses.
 *
 * Every host call is journaled so the page can show the guest driving the
 * host, same as the spike's console journal.
 */

import type { AstridBridge, SyncTopicQueue } from './kernel';

export interface HostCall {
  seq: number;
  iface: string;
  fn: string;
  detail: string;
}

export interface LiveHost {
  imports: Record<string, unknown>;
  journal: HostCall[];
}

/** Event source + KV namespace the showcase capsule runs under. */
export const SHOWCASE_SOURCE = 'capsule-prompt-builder';
const KV_NS = 'showcase.prompt-builder';

export function createLiveHost(bridge: AstridBridge): LiveHost {
  if (
    !bridge.hostPublish ||
    !bridge.hostKvGetSync ||
    !bridge.hostKvSetSync ||
    !bridge.hostSubscribeQueue
  ) {
    throw new Error('kernel bridge predates the sync host shims; rebuild kernel-web');
  }

  const journal: HostCall[] = [];
  const record = (iface: string, fn: string, detail: string) => {
    journal.push({ seq: journal.length, iface, fn, detail });
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // --- astrid:ipc/host ---------------------------------------------------
  class Subscription {
    #queue: SyncTopicQueue;
    #topic: string;
    constructor(topicPattern: string) {
      this.#topic = topicPattern;
      this.#queue = bridge.hostSubscribeQueue!(topicPattern);
    }
    recv(_timeoutMs: bigint) {
      // Drain whatever the real bus has queued; empty envelope is the
      // documented "timeout / no messages" signal, so the capsule's poll
      // loops terminate exactly as they do against the native host.
      // drain() parses each payload back to a JSON value; the WIT payload is
      // a string, so re-stringify (a bare string passes through unquoted).
      const entries = JSON.parse(this.#queue.drain()) as { topic: string; data: unknown }[];
      record('astrid:ipc/host', 'Subscription.recv', `${this.#topic} -> ${entries.length} msg`);
      return {
        messages: entries.map((e) => ({
          topic: e.topic,
          payload: typeof e.data === 'string' ? e.data : JSON.stringify(e.data),
          sourceId: 'astrid-web',
          principal: { tag: 'system' as const },
        })),
        dropped: this.#queue.dropped(),
        lagged: 0n,
      };
    }
  }

  const ipc = {
    Subscription,
    publish(topic: string, payload: string) {
      record('astrid:ipc/host', 'publish', topic);
      try {
        bridge.hostPublish!(SHOWCASE_SOURCE, topic, payload);
      } catch {
        // Non-JSON payloads still deserve a real delivery: publish them as a
        // JSON string rather than dropping the event.
        bridge.hostPublish!(SHOWCASE_SOURCE, topic, JSON.stringify(payload));
      }
    },
    subscribe(topicPattern: string) {
      record('astrid:ipc/host', 'subscribe', topicPattern);
      return new Subscription(topicPattern);
    },
  };

  // --- astrid:kv/host ----------------------------------------------------
  const kv = {
    kvGet(key: string): Uint8Array | undefined {
      const v = bridge.hostKvGetSync!(KV_NS, key);
      record('astrid:kv/host', 'kvGet', `${key} -> ${v === undefined ? 'none' : `${v.length}B`}`);
      return v === undefined ? undefined : enc.encode(v);
    },
    kvSet(key: string, value: Uint8Array) {
      bridge.hostKvSetSync!(KV_NS, key, dec.decode(value));
      record('astrid:kv/host', 'kvSet', `${key} (${value.length}B)`);
    },
    kvDelete(key: string) {
      // The bridge has no sync delete; an empty write is an honest tombstone
      // for a demo namespace and is journaled as such.
      bridge.hostKvSetSync!(KV_NS, key, '');
      record('astrid:kv/host', 'kvDelete', `${key} (tombstoned)`);
    },
  };

  // --- astrid:sys/host ---------------------------------------------------
  const t0 = performance.now();
  const sys = {
    getConfig(key: string): string | undefined {
      record('astrid:sys/host', 'getConfig', `${key} -> none (compiled defaults)`);
      return undefined;
    },
    log(level: string, message: string) {
      record('astrid:sys/host', 'log', `[${level}] ${message}`);
    },
    clockMonotonicNs(): bigint {
      return BigInt(Math.trunc((performance.now() - t0) * 1e6));
    },
    randomBytes(length: bigint): Uint8Array {
      const out = new Uint8Array(Number(length));
      crypto.getRandomValues(out);
      record('astrid:sys/host', 'randomBytes', `${out.length}B`);
      return out;
    },
    checkCapsuleCapability(request: { sourceUuid: string; capability: string }) {
      // The showcase guest holds no capsule capabilities; denial is the
      // truthful answer and the capsule handles it.
      record('astrid:sys/host', 'checkCapsuleCapability', `${request.capability} -> denied`);
      return { allowed: false };
    },
  };

  const imports: Record<string, unknown> = {
    'astrid:ipc/host': ipc,
    'astrid:kv/host': kv,
    'astrid:sys/host': sys,
    'astrid:guest/lifecycle': {},
    'astrid:ipc/host@1.0.0': ipc,
    'astrid:kv/host@1.0.0': kv,
    'astrid:sys/host@1.0.0': sys,
    'astrid:guest/lifecycle@1.0.0': {},
  };

  return { imports, journal };
}
