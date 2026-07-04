/**
 * Scroll choreography. The rail (astrid-rail) handles all dock/clamp visuals
 * itself; this module only reveals section content as it enters. Nothing
 * traps the wheel; with reduced motion everything renders in its completed
 * state and this module does nothing.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { burstKick } from './burst-link';

// Leaving the page (client-router swap) strands triggers on removed DOM;
// kill them at the boundary so nothing computes against dead elements.
document.addEventListener('astro:before-swap', () => {
  for (const t of ScrollTrigger.getAll()) t.kill();
});

export function initScenes(): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  gsap.registerPlugin(ScrollTrigger);

  // Client-router navigations replace the content while this module (and
  // GSAP) persist: kill triggers bound to the previous page's DOM first.
  for (const t of ScrollTrigger.getAll()) t.kill();

  // Every section is a capsule: it gets CAUGHT off the spine, then expands
  // into its content. The rail draws the clamp; here the content unfolds out
  // of the rail's side (origin left, sliding in from the spine) while the
  // eye gets a small kick at the catch.
  for (const scene of document.querySelectorAll<HTMLElement>('[data-scene]')) {
    const targets = scene.querySelectorAll<HTMLElement>(
      '.thesis-line, .thesis-note, .scene-copy, .endpoints, .capsule-rack, .prose, .layers-rig, .grow-quote, .books-grid, .cap-rig, .aud-rows, .keys-chain, .receipt',
    );
    if (!targets.length) continue;
    gsap.from(targets, {
      x: -34,
      scale: 0.965,
      transformOrigin: 'left center',
      autoAlpha: 0,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.12,
      scrollTrigger: {
        trigger: scene,
        start: 'top 72%',
        onEnter: () => burstKick(3),
      },
    });
  }

  // stations cascade in from the spine side as it reaches them
  const steps = document.querySelectorAll<HTMLElement>('[data-step]');
  for (const step of steps) {
    gsap.from(step, {
      x: -24,
      autoAlpha: 0,
      duration: 0.7,
      ease: 'power3.out',
      scrollTrigger: { trigger: step, start: 'top 78%' },
    });
  }
}
