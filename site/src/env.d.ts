/// <reference types="astro/client" />

/**
 * 'kernel-web' is a Vite alias (see astro.config.mjs): the wasm-pack output
 * of the kernel bridge crate, or a throwing stub until that pkg is built.
 */
declare module 'kernel-web' {
  const init: () => Promise<unknown>;

  export class AstridWeb {
    static boot(): Promise<AstridWeb>;
    kernelCommit(): string;
    kvSet(ns: string, key: string, val: string): Promise<void>;
    kvGet(ns: string, key: string): Promise<string | undefined>;
    publish(topic: string, json: string): Promise<void>;
    subscribe(pattern: string, cb: (topic: string, json: string) => void): void;
    grant(principal: string, resource: string, perm: string): Promise<string>;
    check(principal: string, resource: string, perm: string): Promise<boolean>;
    auditLen?(): Promise<bigint>;
    auditTail?(n: number): Promise<string>;
    eventsRouted(): bigint;
    /** phase-3 playground surface; absent on older pkg builds */
    guestKvGet?(principal: string, ns: string, key: string): Promise<string | undefined>;
    guestKvSet?(principal: string, ns: string, key: string, val: string): Promise<void>;
    guestPublish?(principal: string, topic: string, json: string): Promise<void>;
    revoke?(tokenId: string): Promise<void>;
    hostPublish?(source: string, topic: string, json: string): void;
    hostKvGetSync?(ns: string, key: string): string | undefined;
    hostKvSetSync?(ns: string, key: string, val: string): void;
    hostSubscribeQueue?(pattern: string): SyncTopicQueue;
  }

  export class SyncTopicQueue {
    drain(): string;
    dropped(): bigint;
  }

  export default init;
}
