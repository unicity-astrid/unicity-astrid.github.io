/**
 * The hero burst, live: a few hundred thin 3D slats radiating from an empty
 * centre (the kernel), lit so their top faces catch light and their sides
 * fall into shadow, breathing with a travelling radial wave. Raw WebGL2
 * instancing, no library; monochrome in the site palette so it never
 * fights the foreground. In the spirit of the rest of this site it is not
 * a pre-rendered video: it is computed in your tab, every frame.
 */

const VERT = `#version 300 es
precision highp float;

// unit box: x in [0,1] (radial axis), y/z in [-0.5, 0.5]
in vec3 aPos;
in vec3 aNormal;
// per instance: angle, startRadius, baseLength, phase
in vec4 aSeed;
// per instance: width, thickness, shade jitter, accent (0|1|2)
in vec4 aDim;
// per instance: depth level (0|1|2) — parallel discs, each rotating at its
// own speed and direction
in float aLayer;

uniform mat4 uVP;
uniform mat3 uTilt;
uniform vec3 uCenter;
uniform float uTime;

out float vLight;
out float vShade;
out float vAccent;
out float vR;

void main() {
  float spin = aLayer < 0.5 ? 0.013 : (aLayer < 1.5 ? -0.019 : 0.027);
  float ang = aSeed.x + uTime * spin;
  // travelling wave, two frequencies moving in opposite directions, shaped
  // (sharp crest, slow trough) so slats feel pushed out and springing back
  // rather than metronomically pulsing
  float w1 = sin(ang * 3.0 + aSeed.w + uTime * 0.55);
  float w2 = sin(ang * 7.0 - uTime * 0.95 + aSeed.w * 1.7);
  float w = 0.64 * w1 + 0.36 * w2;
  w = sign(w) * pow(abs(w), 0.72);
  float len = aSeed.z * (0.78 + 0.25 * w);
  // the whole slat also shifts bodily outward a touch, like it was shoved
  float r0 = aSeed.y + 0.09 * w;

  vec3 local = vec3(r0 + aPos.x * len, aPos.y * aDim.x, aPos.z * aDim.y);
  float c = cos(ang), s = sin(ang);
  vec3 spun = vec3(c * local.x - s * local.y, s * local.x + c * local.y, local.z);
  spun.z += (aLayer - 1.0) * 0.55; // separate the discs in depth
  vec3 world = uTilt * spun + uCenter;

  vec3 n = vec3(c * aNormal.x - s * aNormal.y, s * aNormal.x + c * aNormal.y, aNormal.z);
  n = uTilt * n;
  vLight = max(dot(n, normalize(vec3(0.35, 0.6, 0.72))), 0.0);
  vShade = aDim.z;
  vAccent = aDim.w;
  vR = (r0 + len) / 4.2;

  gl_Position = uVP * vec4(world, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;

in float vLight;
in float vShade;
in float vAccent;
in float vR;
uniform float uTime;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // monochrome violet-greys; definition comes from the lighting, like the
  // reference. A sparse few slats carry the bus/audit accents.
  vec3 base = mix(vec3(0.078, 0.086, 0.133), vec3(0.196, 0.203, 0.322), vShade);
  if (vAccent > 1.5) base = vec3(0.22, 0.42, 0.40);        // bus teal, dimmed
  else if (vAccent > 0.5) base = vec3(0.42, 0.32, 0.62);   // capsule purple, dimmed
  vec3 col = base * (0.38 + 0.85 * vLight);
  // surface tooth; the full-frame film grain is a separate pass
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * 0.03;
  // fade the far rim out so the burst dissolves instead of hard-stopping
  float fade = 1.0 - smoothstep(0.72, 1.05, vR);
  outColor = vec4(col * fade, fade);
}`;

// full-frame film grain: an attributeless fullscreen triangle over the
// whole canvas, so the void between slats has the same tooth as the slats
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

// unit slat (radial axis x in [0,1]); the inner face is never visible from
// outside the ring, so five faces suffice: 5 x 2 tris x 3 verts = 30.
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
  return { pos: new Float32Array(p), nrm: new Float32Array(n) };
}

const COUNT = 380;

function instanceData(): { seed: Float32Array; dim: Float32Array; layer: Float32Array } {
  const seed = new Float32Array(COUNT * 4);
  const dim = new Float32Array(COUNT * 4);
  const layer = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const band = rand(i, 11);
    seed[i * 4] = rand(i, 1) * Math.PI * 2;
    seed[i * 4 + 1] = 1.05 + band * 1.35; // start radius
    seed[i * 4 + 2] = 0.6 + rand(i, 3) * 1.8 * (0.45 + band * 0.55); // length
    seed[i * 4 + 3] = rand(i, 4) * Math.PI * 2; // phase
    // planks, not sticks: wide in the disc plane, thin through it
    dim[i * 4] = 0.06 + rand(i, 5) * 0.09; // width
    dim[i * 4 + 1] = 0.012 + rand(i, 6) * 0.012; // thickness
    dim[i * 4 + 2] = rand(i, 7); // shade jitter
    const a = rand(i, 8);
    dim[i * 4 + 3] = a > 0.955 ? 2 : a > 0.87 ? 1 : 0; // sparse accents
    layer[i] = Math.floor(rand(i, 9) * 3); // depth level
  }
  return { seed, dim, layer };
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

/**
 * Boot the burst on a canvas. Returns null if WebGL2 is unavailable (the
 * caller keeps its static fallback), else a stop function that cancels the
 * loop and releases the GL context — call it before the canvas leaves the
 * DOM, because browsers cap live WebGL contexts (~16) and client-router
 * navigations mint a fresh canvas each visit. centerFrac places the burst
 * centre in canvas fractions (x from left, y from top).
 */
export function startBurst(
  canvas: HTMLCanvasElement,
  centerFrac: { x: number; y: number },
): (() => void) | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true });
  if (!gl) return null;

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[burst] link failed:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const geo = boxGeometry();
  const inst = instanceData();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const attach = (
    name: string, data: Float32Array, size: number, divisor: number,
  ) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    if (divisor) gl.vertexAttribDivisor(loc, divisor);
  };
  attach('aPos', geo.pos, 3, 0);
  attach('aNormal', geo.nrm, 3, 0);
  attach('aSeed', inst.seed, 4, 1);
  attach('aDim', inst.dim, 4, 1);
  attach('aLayer', inst.layer, 1, 1);

  const uVP = gl.getUniformLocation(prog, 'uVP');
  const uTilt = gl.getUniformLocation(prog, 'uTilt');
  const uCenter = gl.getUniformLocation(prog, 'uCenter');
  const uTime = gl.getUniformLocation(prog, 'uTime');

  const grainProg = gl.createProgram()!;
  gl.attachShader(grainProg, compile(gl, gl.VERTEX_SHADER, GRAIN_VERT));
  gl.attachShader(grainProg, compile(gl, gl.FRAGMENT_SHADER, GRAIN_FRAG));
  gl.linkProgram(grainProg);
  const grainOk = gl.getProgramParameter(grainProg, gl.LINK_STATUS) as boolean;
  const uGrainTime = grainOk ? gl.getUniformLocation(grainProg, 'uTime') : null;
  const grainVao = gl.createVertexArray(); // empty: the triangle is attributeless

  // gentle tilt so the slats show their side faces (the 3D read)
  const tx = 0.52;
  const cx = Math.cos(tx), sx = Math.sin(tx);
  gl.uniformMatrix3fv(uTilt, false, [1, 0, 0, 0, cx, sx, 0, -sx, cx]);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

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
    gl!.viewport(0, 0, w, h);
    const aspect = w / h;
    gl!.uniformMatrix4fv(uVP, false, perspective(FOVY, aspect, 0.1, 60));
    // place the burst centre at the requested canvas fraction
    const f = 1 / Math.tan(FOVY / 2);
    const ndcX = centerFrac.x * 2 - 1;
    const ndcY = 1 - centerFrac.y * 2;
    gl!.uniform3f(uCenter, (ndcX * aspect * DIST) / f, (ndcY * DIST) / f, -DIST);
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

  let raf = 0;
  let stopped = false;
  const frame = (ms: number) => {
    if (stopped) return;
    if (visible) {
      const t = still ? 0 : ms / 1000;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform1f(uTime, t);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, COUNT);
      if (grainOk) {
        gl.useProgram(grainProg);
        gl.bindVertexArray(grainVao);
        gl.disable(gl.DEPTH_TEST);
        gl.uniform1f(uGrainTime, t);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (still) return; // one composed frame, then rest
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
