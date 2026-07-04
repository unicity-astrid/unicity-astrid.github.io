/**
 * Singleton loader for the real Astrid kernel (kernel-web wasm bridge).
 *
 * The wasm bundle is lazy-loaded after first paint; until boot resolves the
 * page runs in "static mode" and every live element shows its designed
 * fallback state. Nothing on the page fakes liveness: if the kernel is not
 * up, nothing claims it is.
 */

export interface AstridBridge {
  kernelCommit(): string;
  kvSet(ns: string, key: string, val: string): Promise<void>;
  kvGet(ns: string, key: string): Promise<string | undefined>;
  publish(topic: string, json: string): Promise<void>;
  /**
   * Topic grammar (real TopicMatcher semantics): exact match, a trailing
   * `.*` matches the whole subtree, a mid-segment `*` matches one segment.
   * There is no `**`.
   */
  subscribe(pattern: string, cb: (topic: string, json: string) => void): void;
  grant(principal: string, resource: string, perm: string): Promise<string>;
  check(principal: string, resource: string, perm: string): Promise<boolean>;
  auditLen?(): Promise<bigint>;
  auditTail?(n: number): Promise<string>;
  eventsRouted(): bigint;

  // Phase-3 playground surface. Optional until the rebuilt kernel-web pkg
  // ships; the playground page degrades to an honest "kernel offline /
  // bridge too old" state when these are absent.

  /** Capability-checked KV read for a guest principal; throws on denial. */
  guestKvGet?(principal: string, ns: string, key: string): Promise<string | undefined>;
  /** Capability-checked KV write for a guest principal; throws on denial. */
  guestKvSet?(principal: string, ns: string, key: string, val: string): Promise<void>;
  /** Capability-checked publish, stamped with the guest as event source. */
  guestPublish?(principal: string, topic: string, json: string): Promise<void>;
  /** Revoke a granted token by id (present only if the store supports it). */
  revoke?(tokenId: string): Promise<void>;

  /** Synchronous shims backing the jco showcase's sync host imports. */
  hostPublish?(source: string, topic: string, json: string): void;
  hostKvGetSync?(ns: string, key: string): string | undefined;
  hostKvSetSync?(ns: string, key: string, val: string): void;
  hostSubscribeQueue?(pattern: string): SyncTopicQueue;
}

/** Drainable queue over a real bus subscription (sync recv for jco guests). */
export interface SyncTopicQueue {
  /** JSON array `[{"topic": ..., "data": ...}]`, oldest first; clears the queue. */
  drain(): string;
  dropped(): bigint;
}

export type KernelStatus = 'booting' | 'online' | 'offline';

type StatusListener = (status: KernelStatus, bridge: AstridBridge | null) => void;

let bridge: AstridBridge | null = null;
let status: KernelStatus = 'booting';
let bootPromise: Promise<AstridBridge | null> | null = null;
const listeners = new Set<StatusListener>();

function setStatus(next: KernelStatus): void {
  status = next;
  for (const l of listeners) l(status, bridge);
}

/** Subscribe to kernel status; fires immediately with the current state. */
export function onKernel(listener: StatusListener): () => void {
  listeners.add(listener);
  listener(status, bridge);
  return () => listeners.delete(listener);
}

export function kernelStatus(): KernelStatus {
  return status;
}

export function kernel(): AstridBridge | null {
  return bridge;
}

/** Idempotent. Called once from the layout after first paint. */
export function bootKernel(): Promise<AstridBridge | null> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const mod = await import('kernel-web');
      await mod.default();
      bridge = (await mod.AstridWeb.boot()) as unknown as AstridBridge;
      setStatus('online');
      return bridge;
    } catch (err) {
      console.warn('[astrid] kernel unavailable, static mode:', err);
      setStatus('offline');
      return null;
    }
  })();
  return bootPromise;
}
