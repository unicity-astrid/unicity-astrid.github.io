/**
 * <astrid-rail> — the bus as a spine.
 *
 * One thin vertical rail runs the full page: that IS the kernel — a dumb,
 * constant, grey pipe. Everything interesting clamps onto it at the edges:
 * elements marked `data-dock="label"` get a connector and a node on the rail
 * as they scroll into view. Real EventBus deliveries run down the rail as
 * teal pulses; when the kernel is offline only sparse, clearly-decorative
 * drift remains (dimmer, slower — never claiming to be data).
 *
 * Mounted once (fixed, full viewport, pointer-events none, behind content).
 * Reduced motion: static rail + fully-clamped connectors, redrawn on scroll,
 * no animation loop and no pulses.
 */
import { onKernel } from './kernel';

interface Dock {
  el: HTMLElement;
  label: string;
  t: number; // clamp progress 0..1
}

interface Pulse {
  y: number;
  speed: number; // px per frame-second
  real: boolean;
}

export class AstridRail extends HTMLElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private docks: Dock[] = [];
  private pulses: Pulse[] = [];
  private live = false;
  private lastAmbient = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private unsub: (() => void) | null = null;
  private onScroll = () => this.drawStatic();
  private initialized = false;

  connectedCallback(): void {
    // The rail persists across client-router navigations (transition:persist
    // moves the element, which re-fires this callback): re-scan the new
    // page's docks and restart the loop, but never duplicate setup.
    if (this.initialized) {
      this.rescanDocks();
      this.startLoop();
      return;
    }
    this.initialized = true;

    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    } as CSSStyleDeclaration);
    this.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.rescanDocks();
    document.addEventListener('astro:page-load', () => this.rescanDocks());

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = innerWidth * dpr;
      this.canvas.height = innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawStatic();
    };
    addEventListener('resize', resize, { passive: true });
    resize();

    this.unsub = onKernel((status, bridge) => {
      if (status === 'online' && bridge && !this.live) {
        this.live = true;
        bridge.subscribe('site.*', () => {
          if (this.pulses.length < 24) {
            this.pulses.push({ y: -24, speed: 420 + Math.random() * 240, real: true });
          }
        });
      }
    });

    if (this.reduced) {
      addEventListener('scroll', this.onScroll, { passive: true });
      this.drawStatic();
    } else {
      this.startLoop();
    }
  }

  private rescanDocks(): void {
    this.docks = Array.from(document.querySelectorAll<HTMLElement>('[data-dock]')).map((el) => ({
      el,
      label: el.dataset.dock ?? '',
      t: this.reduced ? 1 : 0,
    }));
    if (this.reduced) this.drawStatic();
  }

  private startLoop(): void {
    if (this.reduced || this.raf) return;
    const loop = (t: number) => {
      this.step(t);
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  disconnectedCallback(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    // Keep the scroll listener and kernel subscription: a persisted element
    // is disconnected only for the instant the router moves it.
  }

  private railX(): number {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--rail-x').trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 64;
  }

  private step(t: number): void {
    const dt = 1 / 60;
    const vh = innerHeight;
    for (const d of this.docks) {
      const r = d.el.getBoundingClientRect();
      const inView = r.top < vh * 0.78 && r.bottom > vh * 0.08;
      d.t = Math.min(1, Math.max(0, d.t + (inView ? dt * 2.2 : -dt * 2.2)));
    }
    for (const p of this.pulses) p.y += p.speed * dt;
    this.pulses = this.pulses.filter((p) => p.y < vh + 40);

    // decoration only while the kernel is not live
    if (!this.live && t - this.lastAmbient > 3400) {
      this.lastAmbient = t;
      this.pulses.push({ y: -24, speed: 240, real: false });
    }
  }

  private palette() {
    const s = getComputedStyle(this);
    return {
      rail: s.getPropertyValue('--kernel').trim() || '#969696',
      line: s.getPropertyValue('--line-bright').trim() || '#ffffff1f',
      bus: s.getPropertyValue('--bus').trim() || '#ff6f00',
      capsule: s.getPropertyValue('--capsule').trim() || '#ffa966',
    };
  }

  private drawStatic(): void {
    this.draw(0);
  }

  private draw(_t: number): void {
    const { ctx } = this;
    const w = innerWidth;
    const vh = innerHeight;
    const x = this.railX();
    const c = this.palette();
    ctx.clearRect(0, 0, w, vh);

    // the kernel: one thin, constant, grey line. That's the whole point.
    ctx.strokeStyle = c.rail;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, vh);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // dock connectors: clamp from the rail to each element's edge
    for (const d of this.docks) {
      if (d.t <= 0.02) continue;
      const r = d.el.getBoundingClientRect();
      if (r.bottom < -80 || r.top > vh + 80) continue;
      const y = r.top + r.height / 2;
      const ease = 1 - Math.pow(1 - d.t, 3);
      const reach = Math.max(0, r.left - x - 6);

      ctx.strokeStyle = c.line;
      ctx.globalAlpha = 0.9 * ease;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + reach * ease, y);
      ctx.stroke();

      // node on the rail
      ctx.fillStyle = c.capsule;
      ctx.globalAlpha = ease;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // pulses riding the rail
    for (const p of this.pulses) {
      const grad = ctx.createLinearGradient(x, p.y - 26, x, p.y + 6);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, c.bus);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = p.real ? 0.95 : 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, p.y - 26);
      ctx.lineTo(x, p.y + 4);
      ctx.stroke();
      ctx.fillStyle = c.bus;
      ctx.beginPath();
      ctx.arc(x, p.y + 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

if (!customElements.get('astrid-rail')) {
  customElements.define('astrid-rail', AstridRail);
}
