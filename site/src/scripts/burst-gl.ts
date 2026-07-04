/**
 * The hero burst, live: three paper wheels of thin planks, seen at a slight
 * angle, radiating from an empty centre (the kernel). Planks are FIXED to
 * their wheel — the motion is the wheel's: it spins and slows organically
 * into a stop, like a hand-spun paper wheel. Each wheel is a spring-damped
 * rotation integrated on the CPU; planks lag the wheel slightly by inertia,
 * so a spin fans them out and they slide back as it settles.
 *
 * Depth of field: every wheel renders into an offscreen target and gets a
 * true two-pass Gaussian blur — slight on the front wheel, heavier toward
 * the back — then the wheels composite back to front. Within a wheel there
 * is no depth test at all: planks draw in a fixed painter's order with
 * backface culling, so crossings read as clean paper layering, never as
 * interpenetration.
 *
 * The burst is also an instrument: real routed kernel events nudge the
 * wheels and light the accent planks. Raw WebGL2 instancing, no library.
 * In the spirit of the rest of this site it is not a pre-rendered video:
 * it is computed in your tab, every frame.
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

uniform mat4 uVP;
uniform mat3 uTilt;
uniform vec3 uCenter;
// scroll condensation: the whole disc contracts around its centre
uniform float uScale;
// this wheel's rotation, angular velocity, and depth offset
uniform vec3 uWheel;

out float vLight;
out float vShade;
out float vAccent;
out float vR;

void main() {
  // fixed to the path: only the wheel angle moves. The inertia lag makes
  // planks trail a fast-moving wheel and slide back as it settles.
  float ang = aSeed.x + uWheel.x - uWheel.y * aSeed.w;

  vec3 local = vec3(aSeed.y + aPos.x * aSeed.z, aPos.y * aDim.x, aPos.z * aDim.y);
  float c = cos(ang), s = sin(ang);
  vec3 spun = vec3(c * local.x - s * local.y, s * local.x + c * local.y, local.z);
  spun.z += uWheel.z;
  vec3 world = uTilt * spun * uScale + uCenter;

  vec3 n = vec3(c * aNormal.x - s * aNormal.y, s * aNormal.x + c * aNormal.y, aNormal.z);
  n = uTilt * n;
  vLight = max(dot(n, normalize(vec3(0.35, 0.6, 0.72))), 0.0);
  vShade = aDim.z;
  vAccent = aDim.w;
  vR = (aSeed.y + aSeed.z) / 4.2;

  gl_Position = uVP * vec4(world, 1.0);
}`;

// output is PREMULTIPLIED alpha: blur and compositing stay fringe-free
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

const QUAD_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// separable Gaussian, 5 taps with linear-sampling offsets; uStep carries
// direction, texel size, and per-wheel strength in one vec2
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += (texture(uTex, vUv + uStep * 1.3846153846) +
        texture(uTex, vUv - uStep * 1.3846153846)) * 0.3162162162;
  c += (texture(uTex, vUv + uStep * 3.2307692308) +
        texture(uTex, vUv - uStep * 3.2307692308)) * 0.0702702703;
  outColor = c;
}`;

// composite a wheel texture over the page (data is premultiplied)
const BLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUv);
}`;

// full-frame film grain: an attributeless fullscreen triangle over the
// whole canvas, so the void between planks has the same tooth as the planks
const GRAIN_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
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

// unit plank (radial axis x in [0,1]); six faces, all wound CCW-outward so
// backface culling replaces the depth test within a wheel
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
  quad([0, -h, -h], [0, -h, h], [0, h, h], [0, h, -h], [-1, 0, 0]); // inner cap
  return { pos: new Float32Array(p), nrm: new Float32Array(n) };
}

const COUNT = 520;
const WHEELS = 3;
const WHEEL_Z = [-0.42, 0, 0.42];
// Gaussian strength per wheel, in source texels (0 = back wheel, heaviest)
const BLUR_STRENGTH = [2.6, 1.2, 0.4];
// offscreen scale: high enough that sharpness comes from the blur radius,
// not from resolution crunch
const TARGET_SCALE = 0.75;

interface WheelData {
  seed: Float32Array;
  dim: Float32Array;
  count: number;
}

function wheelData(): WheelData[] {
  const per: { seed: number[]; dim: number[] }[] = [
    { seed: [], dim: [] },
    { seed: [], dim: [] },
    { seed: [], dim: [] },
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
  }
  return per.map((w) => ({
    seed: new Float32Array(w.seed),
    dim: new Float32Array(w.dim),
    count: w.dim.length / 4,
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

export interface BurstHandle {
  /** stop the loop and release the GL context */
  stop(): void;
  /** feed real kernel activity in: events nudge the wheels and light accents */
  kick(events: number): void;
  /**
   * scroll condensation, 0..1: the wheels spin up, the depth blur tightens,
   * the accents brighten, and the whole disc contracts toward the condense
   * target — the dot on the rail the rest of the page builds on. Pure
   * function of p, so scrolling back re-expands it exactly.
   */
  scrub(p: number): void;
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
  // where the condensed dot lands, in canvas fractions, re-read every frame
  // while scrubbing so it tracks resizes (the rail x is in px, not %)
  condenseTo?: () => { x: number; y: number },
): BurstHandle | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!gl) return null;

  const prog = link(gl, VERT, FRAG);
  if (!prog) return null;
  const blurProg = link(gl, QUAD_VERT, BLUR_FRAG);
  const blitProg = link(gl, QUAD_VERT, BLIT_FRAG);
  const grainProg = link(gl, QUAD_VERT, GRAIN_FRAG);
  if (!blurProg || !blitProg) return null;

  gl.useProgram(prog);
  const geo = boxGeometry();
  const wheels = wheelData();

  const makeBuf = (data: Float32Array) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  };
  const posBuf = makeBuf(geo.pos);
  const nrmBuf = makeBuf(geo.nrm);

  const loc = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    nrm: gl.getAttribLocation(prog, 'aNormal'),
    seed: gl.getAttribLocation(prog, 'aSeed'),
    dim: gl.getAttribLocation(prog, 'aDim'),
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
    wire(makeBuf(w.seed)!, loc.seed, 4, 1);
    wire(makeBuf(w.dim)!, loc.dim, 4, 1);
    return vao;
  });

  const uVP = gl.getUniformLocation(prog, 'uVP');
  const uTilt = gl.getUniformLocation(prog, 'uTilt');
  const uCenter = gl.getUniformLocation(prog, 'uCenter');
  const uScale = gl.getUniformLocation(prog, 'uScale');
  const uTime = gl.getUniformLocation(prog, 'uTime');
  const uWheel = gl.getUniformLocation(prog, 'uWheel');
  const uEnergy = gl.getUniformLocation(prog, 'uEnergy');
  const uBlurTex = gl.getUniformLocation(blurProg, 'uTex');
  const uBlurStep = gl.getUniformLocation(blurProg, 'uStep');
  const uBlitTex = gl.getUniformLocation(blitProg, 'uTex');
  const uGrainTime = grainProg ? gl.getUniformLocation(grainProg, 'uTime') : null;
  const emptyVao = gl.createVertexArray(); // for attributeless fullscreen tris

  // the eye looks AT the page: pitch shows the planks' side faces (the 3D
  // read) and yaw turns the disc's face toward the screen centre, left of
  // the burst, instead of gazing off-frame
  const PITCH = 0.34;
  const YAW = -0.52;
  const rx = ((a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [[1, 0, 0], [0, c, -s], [0, s, c]];
  })(PITCH);
  const ry = ((a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  })(YAW);
  // M = rx * ry, sent column-major
  const m = Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) =>
      rx[r][0] * ry[0][c] + rx[r][1] * ry[1][c] + rx[r][2] * ry[2][c],
    ),
  );
  gl.uniformMatrix3fv(uTilt, false, [
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
  ]);

  // paper rules: no depth test anywhere. Within a wheel, fixed painter's
  // order + backface culling; between wheels, back-to-front compositing.
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.enable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  // per wheel: a render texture; plus one shared scratch for blur ping-pong
  const mkTex = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const wheelTex = [mkTex(), mkTex(), mkTex()];
  const scratchTex = mkTex();
  const wheelFbo = wheelTex.map((tex) => {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  });
  const scratchFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scratchTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let tgtW = 0;
  let tgtH = 0;

  const DIST = 10;
  const FOVY = (35 * Math.PI) / 180;
  const F = 1 / Math.tan(FOVY / 2);
  let aspect = 1;

  // canvas fraction → world position on the z = -DIST plane
  const worldFromFrac = (fx: number, fy: number): [number, number, number] => [
    ((fx * 2 - 1) * aspect * DIST) / F,
    ((1 - fy * 2) * DIST) / F,
    -DIST,
  ];

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    aspect = w / h;
    gl!.useProgram(prog);
    gl!.uniformMatrix4fv(uVP, false, perspective(FOVY, aspect, 0.1, 60));

    tgtW = Math.max(1, Math.round(w * TARGET_SCALE));
    tgtH = Math.max(1, Math.round(h * TARGET_SCALE));
    for (const tex of [...wheelTex, scratchTex]) {
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, tgtW, tgtH, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
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
  // per-wheel extra rotation over the full condensation (mixed directions,
  // so the collapse reads as the whole mechanism winding shut)
  const SPIN = [2.8, -3.6, 4.6];
  let energy = 0;
  let scrubP = 0;
  let last = 0;
  let raf = 0;
  let stopped = false;

  const frame = (ms: number) => {
    if (stopped) return;
    if (visible) {
      const t = still ? 0 : ms / 1000;
      const dt = last ? (ms - last) / 1000 : 1 / 60;
      last = ms;
      if (!still) for (const s of springs) s.step(t, dt);
      energy *= Math.exp(-Math.min(dt, 0.1) * 1.6);

      // condensation: smooth the scroll fraction, contract the disc, and
      // drift its centre toward the landing dot on the rail
      const e = scrubP * scrubP * (3 - 2 * scrubP);
      const tgt = condenseTo?.() ?? centerFrac;
      const cx = centerFrac.x + (tgt.x - centerFrac.x) * e;
      const cy = centerFrac.y + (tgt.y - centerFrac.y) * e;
      // mid-collapse the wheels carry fake velocity so the planks fan out,
      // then tuck back in as the disc closes to a dot
      const fan = 4 * scrubP * (1 - scrubP);

      gl.viewport(0, 0, tgtW, tgtH);
      for (let i = 0; i < WHEELS; i++) {
        // pass 1: the wheel into its texture (premultiplied)
        gl.useProgram(prog);
        gl.uniform1f(uTime, t);
        gl.uniform1f(uEnergy, energy + 1.1 * e);
        gl.uniform1f(uScale, 1 - 0.955 * e);
        gl.uniform3fv(uCenter, worldFromFrac(cx, cy));
        gl.uniform3f(
          uWheel,
          springs[i].theta + SPIN[i] * e,
          springs[i].vel + SPIN[i] * fan,
          WHEEL_Z[i],
        );
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindFramebuffer(gl.FRAMEBUFFER, wheelFbo[i]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindVertexArray(vaos[i]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wheels[i].count);

        // pass 2: true Gaussian, horizontal then vertical, per-wheel radius;
        // the depth of field racks toward sharp as the disc condenses
        const s = BLUR_STRENGTH[i] * (1 - 0.9 * e);
        gl.useProgram(blurProg);
        gl.bindVertexArray(emptyVao);
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(uBlurTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo);
        gl.bindTexture(gl.TEXTURE_2D, wheelTex[i]);
        gl.uniform2f(uBlurStep, s / tgtW, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, wheelFbo[i]);
        gl.bindTexture(gl.TEXTURE_2D, scratchTex);
        gl.uniform2f(uBlurStep, 0, s / tgtH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.BLEND);
      }

      // pass 3: composite back to front, then the film grain
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(blitProg);
      gl.bindVertexArray(emptyVao);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1i(uBlitTex, 0);
      for (let i = 0; i < WHEELS; i++) {
        gl.bindTexture(gl.TEXTURE_2D, wheelTex[i]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      if (grainProg) {
        gl.useProgram(grainProg);
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
    scrub(p: number) {
      if (still) return;
      scrubP = Math.min(1, Math.max(0, p));
    },
  };
}
