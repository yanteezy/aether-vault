/** Raw WebGL2 star renderer for «Галактика»: every star is one instance of a camera-facing quad, one draw call. */
import type { OrbitCamera } from './camera.js'

// Looks as in the concept (G3D mockup): a star is a flat disc in its colour; stars bigger than 2.4 px also get
// a soft glow (the same disc blurred by 3.4 px at 75 %). Everything is premultiplied and painted over:
// nebulae, then the lines, then the stars.
const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aPosA;
layout(location=2) in vec3 aPosB;
layout(location=3) in float aSize;
layout(location=4) in float aBright;
layout(location=5) in vec3 aColor;
layout(location=6) in float aFlag; // 0 normal, 1 selected, 2 linked, 3 dimmed
uniform mat4 uView, uProj;
uniform vec2 uViewport;   // device px
uniform float uMix, uDpr, uGlow, uPick, uCamDist;
out vec2 vUv; out vec3 vCol; out float vAlpha; out float vFlag; out float vHalf; out float vCore;
flat out vec3 vId;
void main(){
  vec3 p = mix(aPosA, aPosB, uMix);
  vec4 vp = uView * vec4(p, 1.0);
  float dist = -vp.z;
  if (dist < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float sizeK = aFlag > 0.5 && aFlag < 1.5 ? 1.5 : 1.0;
  float diam = aSize * sizeK * uProj[1][1] * uViewport.y / dist;
  float coreR = clamp(diam * 0.5, 0.8 * uDpr, 9.0 * sizeK * uDpr);
  float pad = max(uGlow > 0.5 ? 10.0 : 1.0, aFlag > 0.5 && aFlag < 2.5 ? 8.0 : 1.0) * uDpr;
  float halfPx = uPick > 0.5 ? max(coreR, 5.0 * uDpr) : coreR + pad;
  vec4 clip = uProj * vp;
  clip.xy += aCorner * halfPx * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  float near = clamp(1.25 - ((dist - uCamDist) + 0.45 * uCamDist) / (1.1 * uCamDist), 0.3, 1.0);
  float b = aBright * near;
  if (aFlag > 2.5) b *= 0.22;
  if (aFlag > 0.5 && aFlag < 2.5) b = 1.0;
  vUv = aCorner; vHalf = halfPx; vCore = coreR; vFlag = aFlag; vAlpha = clamp(b, 0.0, 1.0);
  vCol = aColor;
  int id = gl_InstanceID + 1;
  vId = vec3(float(id & 255), float((id >> 8) & 255), float(id >> 16)) / 255.0;
}`

const FS = `#version 300 es
precision highp float; // same precision as the vertex shader: shared uniforms (uGlow) must match or the program fails to link
in vec2 vUv; in vec3 vCol; in float vAlpha; in float vFlag; in float vHalf; in float vCore;
flat in vec3 vId;
uniform float uGlow, uPick, uDpr;
out vec4 o;
void main(){
  float d = length(vUv) * vHalf; // device px from the centre
  if (d > vHalf) discard;
  if (uPick > 0.5) { o = vec4(vId, 1.0); return; }
  float disc = clamp(vCore - d + 0.5, 0.0, 1.0) * vAlpha;
  float glow = 0.0;
  if (uGlow > 0.5 && vCore > 2.4 * uDpr && vFlag < 2.5) {
    float s = 3.4 * uDpr; // the blur of the concept's glow filter
    float e = max(d - vCore * 0.5, 0.0);
    glow = 0.75 * (1.0 - exp(-vCore * vCore / (2.0 * s * s))) * exp(-e * e / (2.0 * s * s));
  }
  float a = disc + (1.0 - disc) * glow;
  vec3 c = vCol * a;
  if (vFlag > 0.5 && vFlag < 2.5) { // ring #6cb4ff around the chosen star and its links
    float rr = vCore + 4.0 * uDpr;
    float ring = (1.0 - smoothstep(0.0, 1.2 * uDpr, abs(d - rr) - 0.8 * uDpr)) * (vFlag < 1.5 ? 1.0 : 0.8);
    c = mix(c, vec3(0.4235, 0.7059, 1.0), ring); a = max(a, ring);
  }
  o = vec4(c, a);
}`

const EVS = `#version 300 es
layout(location=1) in vec3 aPosA;
layout(location=2) in vec3 aPosB;
uniform mat4 uView, uProj;
uniform float uMix;
void main(){ gl_Position = uProj * uView * vec4(mix(aPosA, aPosB, uMix), 1.0); }`
const EFS = `#version 300 es
precision highp float;
uniform float uAlpha;
out vec4 o;
void main(){ o = vec4(vec3(0.4235, 0.7059, 1.0) * uAlpha, uAlpha); }`

// Nebulae: a warm core in the middle of the disk (lying in the disk plane, so it flattens with the view) and
// a soft cloud in its colour around each group in «Папками» / «Тегами»: the concept's radial gradients.
const NVS = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uView, uProj;
uniform vec3 uCentre; uniform vec2 uRadius; uniform float uFlat;
out vec2 vUv;
void main(){
  vUv = aCorner;
  vec4 vp = uFlat > 0.5 ? uView * vec4(uCentre + vec3(aCorner.x * uRadius.x, 0.0, aCorner.y * uRadius.y), 1.0)
                        : uView * vec4(uCentre, 1.0) + vec4(aCorner * uRadius, 0.0, 0.0);
  gl_Position = uProj * vp;
}`
const NFS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uColor; uniform float uAlpha, uFlat;
out vec4 o;
void main(){
  float r = length(vUv);
  if (r > 1.0) discard;
  // core: #fff3d6 at 0.9, #ffd9a0 at 0.45 (30 %), then 0; cloud: its colour at uAlpha, then 0
  float a; vec3 c;
  if (uFlat > 0.5) {
    a = (r < 0.3 ? mix(0.9, 0.45, r / 0.3) : mix(0.45, 0.0, (r - 0.3) / 0.7)) * uAlpha;
    c = mix(vec3(1.0, 0.953, 0.839), vec3(1.0, 0.851, 0.627), clamp(r / 0.3, 0.0, 1.0));
  } else { a = uAlpha * (1.0 - r); c = uColor; }
  o = vec4(c * a, a);
}`

/** A nebula in world units: `flat` lies in the disk plane (the core), otherwise it faces the camera. */
export interface Nebula { x: number; y: number; z: number; rx: number; ry: number; color: [number, number, number]; alpha: number; flat: boolean }

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

export class GalaxyRenderer {
  readonly ok: boolean
  reducedMotion = false
  private gl: WebGL2RenderingContext | null = null
  private lost = false
  private dpr = 1
  private glow = true
  private count = 0
  private a: Float32Array = new Float32Array(0); private b: Float32Array = new Float32Array(0)
  private sizeA: Float32Array = new Float32Array(0); private bright: Float32Array = new Float32Array(0); private color: Float32Array = new Float32Array(0)
  private flags = new Float32Array(0)
  private edges: Uint32Array | null = null
  private edgeAlpha = 0.7
  private mixT0 = 0; private mixMs = 0; private mix = 1
  private starProg: WebGLProgram | null = null; private edgeProg: WebGLProgram | null = null; private nebProg: WebGLProgram | null = null
  private nebulae: Nebula[] = []
  private nu: Record<string, WebGLUniformLocation | null> = {}
  private starVao: WebGLVertexArrayObject | null = null; private edgeVao: WebGLVertexArrayObject | null = null; private nebVao: WebGLVertexArrayObject | null = null
  private bufs: Record<string, WebGLBuffer | null> = {}
  private u: Record<string, WebGLUniformLocation | null> = {}
  private eu: Record<string, WebGLUniformLocation | null> = {}
  private fbo: WebGLFramebuffer | null = null; private rbC: WebGLRenderbuffer | null = null; private rbD: WebGLRenderbuffer | null = null
  private fboW = 0; private fboH = 0
  private readonly px = new Uint8Array(4)

  constructor(private canvas: HTMLCanvasElement) {
    let gl: WebGL2RenderingContext | null = null
    try { gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false }) as WebGL2RenderingContext | null } catch { gl = null }
    this.gl = gl
    if (!gl) console.warn('[galaxy] no WebGL2 context')
    this.ok = !!gl && this.init()
    if (this.ok) {
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true })
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.fbo = null; this.fboW = 0; if (this.init()) this.upload() })
    }
  }

  private compile(vs: string, fs: string): WebGLProgram | null {
    const gl = this.gl!
    const p = gl.createProgram()!
    for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const sh = gl.createShader(t)!
      gl.shaderSource(sh, s); gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn('[galaxy] shader:', gl.getShaderInfoLog(sh)); return null }
      gl.attachShader(p, sh)
    }
    gl.linkProgram(p)
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p
    console.warn('[galaxy] link:', gl.getProgramInfoLog(p))
    return null
  }

  private init(): boolean {
    const gl = this.gl!
    this.starProg = this.compile(VS, FS); this.edgeProg = this.compile(EVS, EFS); this.nebProg = this.compile(NVS, NFS)
    if (!this.starProg || !this.edgeProg || !this.nebProg) return false
    for (const n of ['uView', 'uProj', 'uViewport', 'uMix', 'uDpr', 'uGlow', 'uPick', 'uCamDist']) this.u[n] = gl.getUniformLocation(this.starProg, n)
    for (const n of ['uView', 'uProj', 'uMix', 'uAlpha']) this.eu[n] = gl.getUniformLocation(this.edgeProg, n)
    for (const n of ['uView', 'uProj', 'uCentre', 'uRadius', 'uFlat', 'uColor', 'uAlpha']) this.nu[n] = gl.getUniformLocation(this.nebProg, n)
    for (const n of ['corner', 'a', 'b', 'size', 'bright', 'color', 'flag', 'edges']) this.bufs[n] = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs.corner!)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.starVao = gl.createVertexArray(); gl.bindVertexArray(this.starVao)
    const attr = (loc: number, buf: string, n: number, div: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[buf]!); gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(loc, div)
    }
    attr(0, 'corner', 2, 0); attr(1, 'a', 3, 1); attr(2, 'b', 3, 1); attr(3, 'size', 1, 1); attr(4, 'bright', 1, 1); attr(5, 'color', 3, 1); attr(6, 'flag', 1, 1)
    this.edgeVao = gl.createVertexArray(); gl.bindVertexArray(this.edgeVao)
    attr(1, 'a', 3, 0); attr(2, 'b', 3, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs.edges!)
    this.nebVao = gl.createVertexArray(); gl.bindVertexArray(this.nebVao)
    attr(0, 'corner', 2, 0)
    gl.bindVertexArray(null)
    return true
  }

  private up(name: string, data: ArrayBufferView) {
    const gl = this.gl!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name]!)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
  }

  private upEdges() {
    const gl = this.gl!
    gl.bindVertexArray(this.edgeVao)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs.edges!)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.edges ?? new Uint32Array(0), gl.STATIC_DRAW)
    gl.bindVertexArray(null)
  }

  private upload() {
    if (!this.ok || !this.gl) return
    this.up('a', this.a); this.up('b', this.b); this.up('size', this.sizeA); this.up('bright', this.bright); this.up('color', this.color); this.up('flag', this.flags)
    this.upEdges()
  }

  setStars(positions: Float32Array, size: Float32Array, brightness: Float32Array, color: Float32Array) {
    this.count = size.length
    this.a = positions.slice(); this.b = positions.slice()
    this.sizeA = size; this.bright = brightness; this.color = color
    this.mix = 1
    this.flags = new Float32Array(this.count)
    this.upload()
  }

  /** Animate from the currently shown positions to `next` (instant with reducedMotion). */
  setPositions(next: Float32Array, ms = 600) {
    if (!this.ok || !this.gl || next.length !== this.a.length) return
    const e = this.mixNow()
    if (e < 1) for (let i = 0; i < this.a.length; i++) this.a[i] += (this.b[i] - this.a[i]) * e
    else this.a.set(this.b)
    this.b.set(next)
    this.mixT0 = performance.now(); this.mixMs = this.reducedMotion ? 0 : ms
    this.mix = this.mixMs > 0 ? 0 : 1
    this.up('a', this.a); this.up('b', this.b)
  }

  private mixNow(): number {
    if (this.mix >= 1 || this.mixMs <= 0) return 1
    return ease(Math.min(1, (performance.now() - this.mixT0) / this.mixMs))
  }

  /** True while star positions are still animating (keep calling render). */
  get animating(): boolean { return this.mixNow() < 1 }

  setEmphasis(selected: number, linked: number[] | null) {
    const f = this.flags
    f.fill(linked ? 3 : 0)
    if (linked) for (const i of linked) if (i >= 0 && i < f.length) f[i] = 2
    if (selected >= 0 && selected < f.length) f[selected] = 1
    if (this.ok && this.gl) this.up('flag', f)
  }

  /** Lines between stars; `alpha` lower for the whole web, higher for one star's focus. */
  setEdges(pairs: Uint32Array | null, alpha = 0.7) {
    this.edgeAlpha = alpha
    this.edges = pairs && pairs.length ? pairs : null
    if (this.ok && this.gl) this.upEdges()
  }

  setGlow(on: boolean) { this.glow = on }

  /** The nebulae of the current layout; they fade in with the stars' move to it. */
  setNebulae(list: Nebula[]) { this.nebulae = list }

  resize(cssW: number, cssH: number, dpr: number) {
    this.dpr = dpr || 1
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr))
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr))
  }

  private draw(cam: OrbitCamera, pick: boolean) {
    const gl = this.gl!, W = this.canvas.width, H = this.canvas.height
    const view = cam.view(), proj = cam.projection(W / H)
    gl.viewport(0, 0, W, H)
    const mix = this.mixNow()
    if (!pick && this.glow && this.nebulae.length) {
      gl.useProgram(this.nebProg)
      gl.uniformMatrix4fv(this.nu.uView, false, view); gl.uniformMatrix4fv(this.nu.uProj, false, proj)
      gl.bindVertexArray(this.nebVao)
      for (const n of this.nebulae) {
        gl.uniform3f(this.nu.uCentre, n.x, n.y, n.z); gl.uniform2f(this.nu.uRadius, n.rx, n.ry)
        gl.uniform1f(this.nu.uFlat, n.flat ? 1 : 0); gl.uniform3f(this.nu.uColor, ...n.color); gl.uniform1f(this.nu.uAlpha, n.alpha * mix)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
    }
    if (!pick && this.edges) {
      gl.useProgram(this.edgeProg)
      gl.uniformMatrix4fv(this.eu.uView, false, view); gl.uniformMatrix4fv(this.eu.uProj, false, proj)
      gl.uniform1f(this.eu.uMix, mix); gl.uniform1f(this.eu.uAlpha, this.edgeAlpha)
      gl.bindVertexArray(this.edgeVao)
      gl.drawElements(gl.LINES, this.edges.length, gl.UNSIGNED_INT, 0)
    }
    if (this.count) {
      gl.useProgram(this.starProg)
      gl.uniformMatrix4fv(this.u.uView, false, view); gl.uniformMatrix4fv(this.u.uProj, false, proj)
      gl.uniform2f(this.u.uViewport, W, H)
      gl.uniform1f(this.u.uMix, mix); gl.uniform1f(this.u.uDpr, this.dpr)
      gl.uniform1f(this.u.uGlow, this.glow ? 1 : 0); gl.uniform1f(this.u.uPick, pick ? 1 : 0)
      gl.uniform1f(this.u.uCamDist, cam.distance)
      gl.bindVertexArray(this.starVao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    }
    gl.bindVertexArray(null)
  }

  render(cam: OrbitCamera) {
    if (!this.ok || !this.gl || this.lost) return
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied, painted over like the concept's SVG
    this.draw(cam, false)
  }

  /** Star index under the cursor (CSS px) or -1. Renders the ID pass for one pixel only. */
  pick(cssX: number, cssY: number, cam: OrbitCamera): number {
    if (!this.ok || !this.gl || this.lost || !this.count) return -1
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height
    if (!this.fbo || this.fboW !== W || this.fboH !== H) {
      this.fbo ??= gl.createFramebuffer(); this.rbC ??= gl.createRenderbuffer(); this.rbD ??= gl.createRenderbuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbC); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.rbC)
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbD); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rbD)
      this.fboW = W; this.fboH = H
    }
    const x = Math.floor(cssX * this.dpr), y = H - 1 - Math.floor(cssY * this.dpr)
    if (x < 0 || y < 0 || x >= W || y >= H) return -1
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.disable(gl.BLEND)
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, 1, 1)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    this.draw(cam, true)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.px)
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const id = this.px[0] + this.px[1] * 256 + this.px[2] * 65536
    return id > 0 && id <= this.count ? id - 1 : -1
  }

  dispose() {
    const gl = this.gl
    if (gl && this.ok && !this.lost) {
      for (const b of Object.values(this.bufs)) gl.deleteBuffer(b)
      gl.deleteVertexArray(this.starVao); gl.deleteVertexArray(this.edgeVao); gl.deleteVertexArray(this.nebVao)
      gl.deleteProgram(this.starProg); gl.deleteProgram(this.edgeProg); gl.deleteProgram(this.nebProg)
      gl.deleteFramebuffer(this.fbo); gl.deleteRenderbuffer(this.rbC); gl.deleteRenderbuffer(this.rbD)
    }
    this.count = 0
    this.gl = null
  }
}
