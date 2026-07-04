/**
 * <astrid-bus> — canvas scene of the machine: a deliberately grey kernel
 * core, violet capsules docked around it, teal pulses riding the bus lines.
 *
 * When the real kernel is online, pulses are fired by REAL EventBus
 * deliveries (a subscribe-everything hook); decorative drift never claims to
 * be data. In static/reduced-motion mode the scene renders its completed
 * state with no animation loop.
 *
 * Modes (attribute `mode`):
 *   hero     — core + faint lines + ambient drift, pulses on real events
 *   kernel   — core alone routing between anonymous endpoints
 *   capsules — capsules dock one by one (attribute `docked` = count)
 */
import { onKernel } from './kernel';

interface Capsule {
  label: string;
  angle: number;
  docked: boolean;
  dockT: number; // 0..1 dock animation progress
}

interface Pulse {
  from: number; // capsule index, -1 = offscreen endpoint
  to: number;
  t: number;
  speed: number;
  real: boolean;
}

const CAPSULES = ['provider', 'agent loop', 'tools', 'memory', 'uplink', 'skills'];
const TAU = Math.PI * 2;

export class AstridBus extends HTMLElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private capsules: Capsule[] = [];
  private pulses: Pulse[] = [];
  private lastAmbient = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private live = false;
  private unsub: (() => void) | null = null;
  private visible = false;
  private io: IntersectionObserver | null = null;

  static get observedAttributes(): string[] {
    return ['docked'];
  }

  connectedCallback(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.capsules = CAPSULES.map((label, i) => ({
      label,
      angle: (i / CAPSULES.length) * TAU - Math.PI / 2 + 0.26,
      docked: this.mode !== 'capsules',
      dockT: this.mode !== 'capsules' ? 1 : 0,
    }));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this);
    this.resize();

    // only animate while on screen
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries[0]?.isIntersecting ?? false;
      if (this.visible && !this.reduced) this.start();
      else this.stop();
      if (this.reduced) this.draw(performance.now());
    });
    this.io.observe(this);

    this.unsub = onKernel((status, bridge) => {
      if (status === 'online' && bridge && !this.live) {
        this.live = true;
        // `site.*` = the whole site.* subtree (real TopicMatcher grammar);
        // every page-generated bus event fires a pulse.
        bridge.subscribe('site.*', () => this.onRealEvent());
      }
    });

    this.draw(performance.now());
  }

  disconnectedCallback(): void {
    this.stop();
    this.io?.disconnect();
    this.unsub?.();
  }

  attributeChangedCallback(name: string): void {
    if (name === 'docked') {
      const n = Number(this.getAttribute('docked') ?? 0);
      this.capsules.forEach((c, i) => {
        c.docked = i < n;
      });
      if (this.reduced) this.draw(performance.now());
    }
  }

  private get mode(): string {
    return this.getAttribute('mode') ?? 'hero';
  }

  private onRealEvent(): void {
    if (this.pulses.length > 24) return; // backpressure on the art, not the bus
    const docked = this.capsules.map((c, i) => (c.docked ? i : -1)).filter((i) => i >= 0);
    const from = docked.length ? docked[Math.floor(Math.random() * docked.length)]! : -1;
    let to = docked.length > 1 ? docked[Math.floor(Math.random() * docked.length)]! : -1;
    if (to === from) to = -1;
    this.pulses.push({ from, to, t: 0, speed: 0.9 + Math.random() * 0.5, real: true });
    if (this.reduced || !this.visible) return;
    this.start();
  }

  private resize(): void {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = this.clientWidth;
    this.h = this.clientHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.draw(performance.now());
  }

  private start(): void {
    if (this.raf) return;
    const loop = (t: number) => {
      this.step(t);
      this.draw(t);
      this.raf = this.visible ? requestAnimationFrame(loop) : 0;
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private step(t: number): void {
    const dt = 1 / 60;
    for (const c of this.capsules) {
      c.dockT = Math.min(1, Math.max(0, c.dockT + (c.docked ? dt * 1.6 : -dt * 1.6)));
    }
    for (const p of this.pulses) p.t += dt * p.speed;
    this.pulses = this.pulses.filter((p) => p.t < 1);

    // ambient decoration only when the kernel is NOT live (never fake data
    // while claiming liveness; when live, real events drive everything)
    if (!this.live && this.mode !== 'capsules' && t - this.lastAmbient > 2600) {
      this.lastAmbient = t;
      this.pulses.push({ from: -1, to: -1, t: 0, speed: 0.7, real: false });
    }
  }

  private nodePos(i: number): [number, number] {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const r = Math.min(this.w, this.h) * 0.36;
    if (i < 0) {
      // offscreen endpoint: park just outside the ring at a stable angle
      const a = Math.PI * 0.82;
      return [cx + Math.cos(a) * r * 1.9, cy + Math.sin(a) * r * 1.9];
    }
    const c = this.capsules[i]!;
    const rr = r * (0.55 + 0.45 * easeOut(c.dockT));
    return [cx + Math.cos(c.angle) * rr, cy + Math.sin(c.angle) * rr];
  }

  private draw(t: number): void {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const styles = getComputedStyle(this);
    const cLine = styles.getPropertyValue('--line-bright') || '#2A3048';
    const cKernel = styles.getPropertyValue('--kernel') || '#B8BECF';
    const cBus = styles.getPropertyValue('--bus') || '#5EEAD4';
    const cCapsule = styles.getPropertyValue('--capsule') || '#A78BFA';

    // bus lines
    for (let i = 0; i < this.capsules.length; i++) {
      const c = this.capsules[i]!;
      if (c.dockT <= 0.01) continue;
      const [x, y] = this.nodePos(i);
      ctx.strokeStyle = cLine;
      ctx.globalAlpha = 0.55 * c.dockT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // pulses: capsule -> kernel -> capsule (or endpoint)
    for (const p of this.pulses) {
      const [fx, fy] = this.nodePos(p.from);
      const [tx, ty] = this.nodePos(p.to);
      const seg = p.t < 0.5 ? p.t * 2 : (p.t - 0.5) * 2;
      const [ax, ay] = p.t < 0.5 ? [fx, fy] : [cx, cy];
      const [bx, by] = p.t < 0.5 ? [cx, cy] : [tx, ty];
      const x = ax + (bx - ax) * easeInOut(seg);
      const y = ay + (by - ay) * easeInOut(seg);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 10);
      grad.addColorStop(0, cBus);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.globalAlpha = p.real ? 0.95 : 0.4;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // capsules
    ctx.font = `500 11px 'IBM Plex Mono', monospace`;
    ctx.textAlign = 'center';
    for (let i = 0; i < this.capsules.length; i++) {
      const c = this.capsules[i]!;
      if (c.dockT <= 0.01) continue;
      const [x, y] = this.nodePos(i);
      const a = easeOut(c.dockT);
      ctx.globalAlpha = a;
      ctx.fillStyle = cCapsule + '22';
      ctx.strokeStyle = cCapsule;
      roundRect(ctx, x - 34, y - 14, 68, 28, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = cCapsule;
      ctx.fillText(c.label, x, y + 4, 62);
    }
    ctx.globalAlpha = 1;

    // the kernel: small, grey, quiet. That is the point.
    const kr = 26 + Math.sin(t / 900) * (this.reduced ? 0 : 1.2);
    ctx.fillStyle = '#10131D';
    ctx.strokeStyle = cKernel;
    ctx.lineWidth = 1.25;
    roundRect(ctx, cx - kr, cy - kr * 0.62, kr * 2, kr * 1.24, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = cKernel;
    ctx.font = `500 10px 'IBM Plex Mono', monospace`;
    ctx.fillText('kernel', cx, cy + 3.5);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function easeOut(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

if (!customElements.get('astrid-bus')) {
  customElements.define('astrid-bus', AstridBus);
}
