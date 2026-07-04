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
    /** absent until the astrid-audit wasm fix lands */
    auditLen?(): Promise<bigint>;
    auditTail?(n: number): Promise<string>;
    eventsRouted(): bigint;
  }

  export default init;
}
