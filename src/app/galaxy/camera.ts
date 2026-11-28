/** Orbit camera for the «Галактика» view. World is y-up; the camera looks at `target` from (yaw, pitch, distance). */
type V3 = [number, number, number]
const PITCH_MAX = Math.PI / 2 - 0.05
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const now = () => performance.now()

interface Anim { t0: number; ms: number; yaw0: number; pitch0: number; dist0: number; tgt0: V3; yaw1: number; pitch1: number; dist1: number; tgt1: V3 }

export class OrbitCamera {
  target: V3 = [0, 0, 0]
  yaw = 0.55
  pitch = 0.6
  distance = 1150
  fovY = 0.8
  minDistance = 20
  maxDistance = 20000
  /** Distance to restore on "reset view"; the integrator may set it to fit the data. */
  defaultDistance = 1150 // the whole disk (radius 400) fits above the dock at the oblique preset
  autoRotate = false
  reducedMotion = false

  private anim: Anim | null = null
  private lastInteract = -1e9
  private lastUpdate = -1
  // reused buffers: the returned arrays are overwritten by the next call
  private readonly v = new Float32Array(16)
  private readonly p = new Float32Array(16)
  private readonly vp = new Float32Array(16)
  // basis: right, up, direction from target to eye
  private r: V3 = [1, 0, 0]
  private u: V3 = [0, 1, 0]
  private e: V3 = [0, 0, 1]

  private basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    this.r = [cy, 0, -sy]
    this.u = [-sy * sp, cp, -cy * sp]
    this.e = [cp * sy, sp, cp * cy]
  }

  eye(): V3 {
    this.basis()
    const d = this.distance, t = this.target
    return [t[0] + this.e[0] * d, t[1] + this.e[1] * d, t[2] + this.e[2] * d]
  }

  view(): Float32Array {
    const eye = this.eye()
    const { r, u, e, v } = this
    v[0] = r[0]; v[1] = u[0]; v[2] = e[0]; v[3] = 0
    v[4] = r[1]; v[5] = u[1]; v[6] = e[1]; v[7] = 0
    v[8] = r[2]; v[9] = u[2]; v[10] = e[2]; v[11] = 0
    v[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2])
    v[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2])
    v[14] = -(e[0] * eye[0] + e[1] * eye[1] + e[2] * eye[2])
    v[15] = 1
    return v
  }

  projection(aspect: number): Float32Array {
    const f = 1 / Math.tan(this.fovY / 2), n = 0.5, fa = 1e5, p = this.p
    p.fill(0)
    p[0] = f / aspect; p[5] = f
    p[10] = (fa + n) / (n - fa); p[11] = -1; p[14] = 2 * fa * n / (n - fa)
    return p
  }

  viewProjection(aspect: number): Float32Array {
    const a = this.projection(aspect), b = this.view(), o = this.vp
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
    return o
  }

  /** Set by the view while a pointer drag is in progress: pauses auto-rotate. */
  interacting = false

  private touch() { this.anim = null; this.lastInteract = now() }

  orbit(dxPx: number, dyPx: number) {
    this.touch()
    this.yaw -= dxPx * 0.005
    this.pitch = clamp(this.pitch + dyPx * 0.005, -PITCH_MAX, PITCH_MAX)
  }

  /** Zoom toward the point under the cursor (on the plane through the target) so that point stays put. */
  zoomAt(factor: number, ndcX: number, ndcY: number, aspect: number) {
    this.touch()
    this.basis()
    const d0 = this.distance, d1 = clamp(d0 / factor, this.minDistance, this.maxDistance)
    const k = Math.tan(this.fovY / 2), dx = ndcX * aspect * k * (d0 - d1), dy = ndcY * k * (d0 - d1)
    for (let i = 0; i < 3; i++) this.target[i] += this.r[i] * dx + this.u[i] * dy
    this.distance = d1
  }

  pan(dxPx: number, dyPx: number, viewportHeightPx: number) {
    this.touch()
    this.basis()
    const k = 2 * Math.tan(this.fovY / 2) * this.distance / Math.max(1, viewportHeightPx)
    for (let i = 0; i < 3; i++) this.target[i] += -this.r[i] * dxPx * k + this.u[i] * dyPx * k
  }

  private go(tgt: V3, yaw: number, pitch: number, dist: number, ms: number) {
    pitch = clamp(pitch, -PITCH_MAX, PITCH_MAX)
    dist = clamp(dist, this.minDistance, this.maxDistance)
    if (this.reducedMotion || ms <= 0) {
      this.anim = null; this.target = [...tgt]; this.yaw = yaw; this.pitch = pitch; this.distance = dist
      return
    }
    // take the shortest way round in yaw
    const dy = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))
    this.anim = { t0: now(), ms, yaw0: this.yaw, pitch0: this.pitch, dist0: this.distance, tgt0: [...this.target], yaw1: this.yaw + dy, pitch1: pitch, dist1: dist, tgt1: [...tgt] }
  }

  flyTo(target: V3, distance?: number, ms = 700) {
    this.go(target, this.yaw, this.pitch, distance ?? this.distance, ms)
  }

  preset(p: 'top' | 'oblique' | 'edge', ms = 700) {
    const [yaw, pitch] = p === 'top' ? [this.yaw, PITCH_MAX] : p === 'oblique' ? [0.55, 0.6] : [0.35, 0.1]
    this.go(this.target, yaw, pitch, this.distance, ms)
  }

  /** Advance animations / auto-rotation. Returns true while anything moves (keep rendering). */
  update(nowMs: number): boolean {
    const dt = this.lastUpdate < 0 ? 0 : clamp((nowMs - this.lastUpdate) / 1000, 0, 0.1)
    this.lastUpdate = nowMs
    const a = this.anim
    if (a) {
      const t = clamp((nowMs - a.t0) / a.ms, 0, 1), e = ease(t)
      this.yaw = a.yaw0 + (a.yaw1 - a.yaw0) * e
      this.pitch = a.pitch0 + (a.pitch1 - a.pitch0) * e
      this.distance = a.dist0 + (a.dist1 - a.dist0) * e
      for (let i = 0; i < 3; i++) this.target[i] = a.tgt0[i] + (a.tgt1[i] - a.tgt0[i]) * e
      if (t >= 1) this.anim = null
      return true
    }
    if (this.autoRotate && !this.reducedMotion && !this.interacting && nowMs - this.lastInteract > 2000) {
      this.yaw += 0.03 * dt
      return true
    }
    return false
  }

  /** World point -> CSS pixels. `visible`: in front of the camera and within the viewport (+40px margin). */
  project(x: number, y: number, z: number, width: number, height: number): { x: number; y: number; depth: number; visible: boolean } {
    const m = this.viewProjection(width / Math.max(1, height))
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    if (w <= 0) return { x: 0, y: 0, depth: w, visible: false }
    const px = (cx / w * 0.5 + 0.5) * width, py = (0.5 - cy / w * 0.5) * height, M = 40
    return { x: px, y: py, depth: w, visible: px > -M && px < width + M && py > -M && py < height + M }
  }
}
