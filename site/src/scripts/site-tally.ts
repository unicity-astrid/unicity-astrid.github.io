/**
 * The visitor's tab-lifetime tally: what the OS on this page actually did
 * because of them. Counters only move on REAL outcomes — a real store
 * decision, a real guard block, a real echo reply — never on render. The
 * receipt section prints these; the honesty rule is the whole point.
 */

export interface Tally {
  granted: number;
  denied: number;
  blocked: number;
  replies: number;
}

const tally: Tally = { granted: 0, denied: 0, blocked: 0, replies: 0 };
const listeners = new Set<(t: Tally) => void>();

export function bump(kind: keyof Tally): void {
  tally[kind] += 1;
  for (const l of listeners) l(tally);
}

export function currentTally(): Tally {
  return { ...tally };
}

export function onTally(l: (t: Tally) => void): () => void {
  listeners.add(l);
  l(tally);
  return () => listeners.delete(l);
}
