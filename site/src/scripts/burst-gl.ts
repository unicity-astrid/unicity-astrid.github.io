/**
 * The hero burst, live: three paper wheels of thin planks, seen at a slight
 * angle, radiating from an empty centre (the kernel). Planks are FIXED to
 * their wheel — the motion is the wheel's: it spins, stops abruptly, and
 * wiggles as the spring settles, like a hand-spun paper wheel. Each wheel
 * is a spring-damped rotation integrated on the CPU; planks lag the wheel
 * slightly by inertia, so a fast stop fans them out and they quiver back.
 * The rearmost wheel renders through a low-resolution pass, which reads as
 * gentle depth blur. Raw WebGL2 instancing, no library; monochrome in the
 * site palette. In the spirit of the rest of this site it is not a
 * pre-rendered video: it is computed in your tab, every frame.
 */

const VERT = `#version 300 es
precision highp float;

// unit slat: x in [0,1] (radial axis), y/z in [-0.5, 0.5]
in vec3 aPos;
in vec3 aNormal;
// per instance: angle on the wheel, startRadius, length, inertia lag
in vec4 aSeed;
// per instance: width, thickness, shade jitter, accent (0|1|2)
in vec4 aDim;
// per instance: z jitter, so co-planar planks layer instead of intersecting
in float aJit;

uniform mat4 uVP;
uniform mat3 uTilt;
uniform vec3 uCenter;
// this wheel's rotation, angular velocity, and depth offset
uniform vec3 uWheel;

out float vLight;
out float vShade;
out float vAccent;
out float vR;

void main() {
  // fixed to the path: only the wheel angle moves. The inertia lag makes
  // planks trail a fast-moving wheel and quiver as it snaps to a stop.
  float ang = aSeed.x + uWheel.x - uWheel.y * aSeed.w;

  vec3 local = vec3(aSeed.y + aPos.x * aSeed.z, aPos.y * aDim.x, aPos.z * aDim.y);
  float c = cos(ang), s = sin(ang);
  vec3 spun = vec3(c * local.x - s * local.y, s * local.x + c * local.y, local.z);
  spun.z += uWheel.z + aJit;
  vec3 world = uTilt * spun + uCenter;

  vec3 n = vec3(c * aNormal.x - s * aNormal.y, s * aNormal.x + c * aNormal.y, aNormal.z);
  n = uTilt * n;
  vLight = max(dot(n, normalize(vec3(0.35, 0.6, 0.72))), 0.0);
  vShade = aDim.z;
  vAccent = aDim.w;
  vR = (aSeed.y + aSeed.z) / 4.2;

  gl_Position = uVP * vec4(world, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in float vLight;
in float vShade;
in float vAccent;
in float vR;
uniform float uTime;
// live bus energy: recent kernel events make the accent planks glow
uniform float uEnergy;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // monochrome violet-greys; definition comes from the lighting, like the
  // reference. A sparse few planks carry the bus/audit accents.
  vec3 base = mix(vec3(0.10, 0.11, 0.17), vec3(0.30, 0.31, 0.47), vShade);
  if (vAccent > 1.5) base = vec3(0.30, 0.55, 0.52) * (1.0 + uEnergy * 0.7);
  else if (vAccent > 0.5) base = vec3(0.55, 0.44, 0.82) * (1.0 + uEnergy * 0.7);
  // wide dynamic range: shadowed faces sink toward the bg, lit faces glow
  vec3 col = base * (0.26 + 1.15 * vLight);
  // surface tooth; the full-frame film grain is a separate pass
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.03;
  // fade the far rim out so the burst dissolves instead of hard-stopping
  float fade = 1.0 - smoothstep(0.78, 1.02, vR);
  outColor = vec4(col * fade, fade);
}`;

// blit a low-res layer texture to the screen (bilinear upsample = the blur)
const BLIT_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv);
  // premultiply so composition over the page background is correct
  outColor = vec4(t.rgb * t.a, t.a);
}`;

// full-frame film grain: an attributeless fullscreen triangle over the
// whole canvas, so the void between planks has the same tooth as the planks
const GRAIN_VERT = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const GRAIN_FRAG = `#version 300 es
precision highp float;
uniform float uTime;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float g = hash(gl_FragCoord.xy + fract(uTime * 1.13) * 47.3);
  // cool-toned speckle, alpha-weighted so it reads as grain, not fog
  outColor = vec4(vec3(0.62, 0.64, 0.78), g * g * 0.085);
}`;

const rand = (i: number, salt: number): number => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// unit plank (radial axis x in [0,1]); six faces, 6 x 2 tris x 3 verts = 36
function boxGeometry(): { pos: Float32Array; nrm: Float32Array } {
  const p: number[] = [];
  const n: number[] = [];
  const quad = (
    a: number[], b: number[], c: number[], d: number[], nn: number[],
  ) => {
    p.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) n.push(...nn);
  };
  const h = 0.5;
  quad([0, -h, h], [1, -h, h], [1, h, h], [0, h, h], [0, 0, 1]); // front
  quad([1, -h, -h], [0, -h, -h], [0, h, -h], [1, h, -h], [0, 0, -1]); // back
  quad([0, h, h], [1, h, h], [1, h, -h], [0, h, -h], [0, 1, 0]); // top
  quad([0, -h, -h], [1, -h, -h], [1, -h, h], [0, -h, h], [0, -1, 0]); // bottom
  quad([1, -h, h], [1, -h, -h], [1, h, -h], [1, h, h], [1, 0, 0]); // tip
  quad([0, -h, -h], [0, h, -h], [0, h, h], [0, -h, h], [-1, 0, 0]); // inner cap
  return { pos: new Float32Array(p), nrm: new Float32Array(n) };
}

const COUNT = 520;
const WHEELS = 3;
const WHEEL_Z = [-0.42, 0, 0.42];

interface WheelData {
  seed: Float32Array;
  dim: Float32Array;
  jit: Float32Array;
  count: number;
}

function wheelData(): WheelData[] {
  const per: { seed: number[]; dim: number[]; jit: number[] }[] = [
    { seed: [], dim: [], jit: [] },
    { seed: [], dim: [], jit: [] },
    { seed: [], dim: [], jit: [] },
  ];
  for (let i = 0; i < COUNT; i++) {
    const w = per[Math.floor(rand(i, 9) * WHEELS)];
    const a = rand(i, 8);
    w.seed.push(
      rand(i, 1) * Math.PI * 2,
      // a crisp inner rim: every plank starts near the same circle, so the
      // iris edge reads clean while the outer tips stay ragged
      1.32 + rand(i, 11) * 0.45,
      // many short planks, a few long rays
      0.4 + Math.pow(rand(i, 3), 1.6) * 1.9,
      // inertia lag (radians per rad/s of wheel velocity)
      0.03 + rand(i, 4) * 0.09,
    );
    w.dim.push(
      0.06 + rand(i, 5) * 0.09, // width: planks, wide in the wheel plane
      0.012 + rand(i, 6) * 0.012, // thickness: thin through it
      rand(i, 7), // shade jitter
      a > 0.955 ? 2 : a > 0.87 ? 1 : 0, // sparse accents
    );
    // co-planar planks would intersect mid-face; a per-plank depth nudge
    // turns every crossing into clean layering
    w.jit.push((rand(i, 13) - 0.5) * 0.14);
  }
  return per.map((w) => ({
    seed: new Float32Array(w.seed),
    dim: new Float32Array(w.dim),
    jit: new Float32Array(w.jit),
    count: w.jit.length,
  }));
}

/**
 * A hand-spun wheel: long rests, then a spin toward a new target — quick
 * launch, an organic slow-down as it arrives, the faintest settle at the
 * end. Deterministic per wheel index.
 */
class WheelSpring {
  theta = 0;
  vel = 0;
  private target = 0;
  private nextKick: number;
  private kickN = 0;
  constructor(private idx: number) {
    this.nextKick = 1.2 + idx * 2.1;
  }
  step(t: number, dt: number): void {
    if (t >= this.nextKick) {
      this.kickN += 1;
      const r1 = rand(this.kickN, 31 + this.idx * 7);
      const r2 = rand(this.kickN, 47 + this.idx * 7);
      const dir = r1 > 0.42 ? 1 : -1; // biased so the wheel mostly advances
      const sweep = r2 < 0.18 ? 0.9 + r2 * 2.0 : 0.18 + r2 * 0.5;
      this.target += dir * sweep;
      this.nextKick = t + 3.5 + r1 * 6.0;
    }
    // moderately damped: quick launch, organic slow-down into the stop,
    // the faintest overshoot at the end (not a snap)
    const K = 9;
    const C = 3.4;
    const dtc = Math.min(dt, 0.05);
    this.vel += (K * (this.target - this.theta) - C * this.vel) * dtc;
    this.theta += this.vel * dtc;
  }
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[burst] link failed:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

// cinematic depth of field on the cheap: every wheel renders at reduced
// resolution and the bilinear upsample is the blur — slight on the front
// wheel, heavier toward the back (index 0 = back)
const BLUR_SCALES = [0.34, 0.55, 0.8];

export interface BurstHandle {
  /** stop the loop and release the GL context */
  stop(): void;
  /** feed real kernel activity in: events nudge the wheels and light accents */
  kick(events: number): void;
}

/**
 * Boot the burst on a canvas. Returns null if WebGL2 is unavailable (the
 * caller keeps its static fallback), else a handle whose stop() cancels the
 * loop and releases the GL context — call it before the canvas leaves the
 * DOM, because browsers cap live WebGL contexts (~16) and client-router
 * navigations mint a fresh canvas each visit. centerFrac places the burst
 * centre in canvas fractions (x from left, y from top).
 */
export function startBurst(
  canvas: HTMLCanvasElement,
  centerFrac: { x: number; y: number },
): BurstHandle | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!gl) return null;

  const prog = link(gl, VERT, FRAG);
  if (!prog) return null;
  const blitProg = link(gl, BLIT_VERT, BLIT_FRAG);
  const grainProg = link(gl, GRAIN_VERT, GRAIN_FRAG);

  gl.useProgram(prog);
  const geo = boxGeometry();
  const wheels = wheelData();

  const geoBuf = (data: Float32Array) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  };
  const posBuf = geoBuf(geo.pos);
  const nrmBuf = geoBuf(geo.nrm);

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    nrm: gl.getAttribLocation(prog, 'aNormal'),
    seed: gl.getAttribLocation(prog, 'aSeed'),
    dim: gl.getAttribLocation(prog, 'aDim'),
    jit: gl.getAttribLocation(prog, 'aJit'),
  };

  // one VAO per wheel so each renders as its own pass
  const vaos = wheels.map((w) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const wire = (buf: WebGLBuffer, l: number, size: number, divisor: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(l, divisor);
    };
    wire(posBuf!, loc.pos, 3, 0);
    wire(nrmBuf!, loc.nrm, 3, 0);
    wire(geoBuf(w.seed)!, loc.seed, 4, 1);
    wire(geoBuf(w.dim)!, loc.dim, 4, 1);
    wire(geoBuf(w.jit)!, loc.jit, 1, 1);
    return vao;
  });

  const uVP = gl.getUniformLocation(prog, 'uVP');
  const uTilt = gl.getUniformLocation(prog, 'uTilt');
  const uCenter = gl.getUniformLocation(prog, 'uCenter');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uWheel = gl.getUniformLocation(prog, 'uWheel');
  const uEnergy = gl.getUniformLocation(prog, 'uEnergy');
  const uBlitTex = blitProg ? gl.getUniformLocation(blitProg, 'uTex') : null;
  const uGrainTime = grainProg ? gl.getUniformLocation(grainProg, 'uTime') : null;
  const emptyVao = gl.createVertexArray(); // for attributeless fullscreen tris

  // gentle tilt so the planks show their side faces (the 3D read)
  const tx = 0.52;
  const cx = Math.cos(tx), sx = Math.sin(tx);
  gl.uniformMatrix3fv(uTilt, false, [1, 0, 0, 0, cx, sx, 0, -sx, cx]);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // one reduced-resolution target per wheel; the scale sets its blur
  const targets = BLUR_SCALES.map((scale) => ({
    scale,
    fbo: gl.createFramebuffer(),
    tex: gl.createTexture(),
    depth: gl.createRenderbuffer(),
    w: 0,
    h: 0,
  }));

  const DIST = 10;
  const FOVY = (35 * Math.PI) / 180;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const aspect = w / h;
    gl!.useProgram(prog);
    gl!.uniformMatrix4fv(uVP, false, perspective(FOVY, aspect, 0.1, 60));
    // place the burst centre at the requested canvas fraction
    const f = 1 / Math.tan(FOVY / 2);
    const ndcX = centerFrac.x * 2 - 1;
    const ndcY = 1 - centerFrac.y * 2;
    gl!.uniform3f(uCenter, (ndcX * aspect * DIST) / f, (ndcY * DIST) / f, -DIST);

    for (const t of targets) {
      t.w = Math.max(1, Math.round(w * t.scale));
      t.h = Math.max(1, Math.round(h * t.scale));
      gl!.bindTexture(gl!.TEXTURE_2D, t.tex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, t.w, t.h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.bindRenderbuffer(gl!.RENDERBUFFER, t.depth);
      gl!.renderbufferStorage(gl!.RENDERBUFFER, gl!.DEPTH_COMPONENT16, t.w, t.h);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, t.fbo);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, t.tex, 0);
      gl!.framebufferRenderbuffer(gl!.FRAMEBUFFER, gl!.DEPTH_ATTACHMENT, gl!.RENDERBUFFER, t.depth);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    }
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
  });
  io.observe(canvas);

  const springs = [new WheelSpring(0), new WheelSpring(1), new WheelSpring(2)];
  let energy = 0;
  let last = 0;
  let raf = 0;
  let stopped = false;

  const drawWheel = (i: number) => {
    gl.uniform3f(uWheel, springs[i].theta, springs[i].vel, WHEEL_Z[i]);
    gl.bindVertexArray(vaos[i]);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wheels[i].count);
  };

  const frame = (ms: number) => {
    if (stopped) return;
    if (visible) {
      const t = still ? 0 : ms / 1000;
      const dt = last ? (ms - last) / 1000 : 1 / 60;
      last = ms;
      if (!still) for (const s of springs) s.step(t, dt);
      energy *= Math.exp(-Math.min(dt, 0.1) * 1.6);

      // pass 1: each wheel into its own reduced target (upsample = blur,
      // slight up front, heavier toward the back)
      gl.useProgram(prog);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uEnergy, energy);
      gl.enable(gl.DEPTH_TEST);
      for (let i = 0; i < WHEELS; i++) {
        const tg = targets[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fbo);
        gl.viewport(0, 0, tg.w, tg.h);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawWheel(i);
      }

      // pass 2: composite back to front
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (blitProg) {
        gl.useProgram(blitProg);
        gl.disable(gl.DEPTH_TEST);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(emptyVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(uBlitTex, 0);
        for (let i = 0; i < WHEELS; i++) {
          gl.bindTexture(gl.TEXTURE_2D, targets[i].tex);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }

      if (grainProg) {
        gl.useProgram(grainProg);
        gl.bindVertexArray(emptyVao);
        gl.disable(gl.DEPTH_TEST);
        gl.uniform1f(uGrainTime, t);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (still) return; // one composed frame, then rest
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    kick(events: number) {
      if (events <= 0 || still) return;
      const n = Math.min(events, 24);
      // real kernel traffic physically nudges a wheel and lights the accents
      const i = Math.floor(Math.random() * WHEELS);
      springs[i].vel += (Math.random() > 0.5 ? 1 : -1) * 0.05 * n;
      energy = Math.min(energy + n * 0.08, 1.4);
    },
  };
}
