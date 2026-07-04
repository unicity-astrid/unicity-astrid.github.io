/**
 * A one-slot registry connecting the eye to the rest of the page. The
 * ornament owner (CapsuleRing) sets the live handle; choreography modules
 * (scenes) may nudge it — e.g. a small kick when a section is caught off
 * the spine. Decorative motion only; the honesty rule lives with callers
 * that claim liveness.
 */
import type { BurstHandle } from './burst-gl';

let handle: BurstHandle | null = null;

export function setBurst(b: BurstHandle | null): void {
  handle = b;
}

export function burstKick(n: number): void {
  handle?.kick(n);
}
