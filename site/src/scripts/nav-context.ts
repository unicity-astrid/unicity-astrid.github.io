/**
 * Publishes the visitor's position as real bus events: whenever a new
 * section scrolls into primacy, `site.nav.v1.section {id}` lands on the
 * in-tab kernel bus. The agent pill (and anything else on the bus, including
 * a capsule) can react to where the reader is. No kernel = no events; the
 * observer simply never publishes.
 */
import type { AstridBridge } from './kernel';

let current = '';

export function startNavContext(bridge: AstridBridge): void {
  const targets = document.querySelectorAll<HTMLElement>('section[id]');
  if (!targets.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = (e.target as HTMLElement).id;
        if (id === current) continue;
        current = id;
        void bridge.publish('site.nav.v1.section', JSON.stringify({ id }));
      }
    },
    { rootMargin: '-35% 0px -55% 0px' },
  );
  for (const t of targets) io.observe(t);
}

export function currentSection(): string {
  return current;
}
