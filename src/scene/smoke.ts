import * as THREE from 'three';
import { FOG, LED_STRIP } from './world';

/**
 * Smoke and condensation, drawn as camera-facing instanced quads with a fractal
 * puff texture, sorted back to front every frame. Purely visual — nothing here
 * feeds back into the physics. It is deliberately short-lived: its job is to show
 * where gas and tire smoke come from, not to reproduce the clouds in the footage.
 *
 *  - jet:   cold-gas plumes. Leave the nozzle fast, slow as they entrain air,
 *           widen with distance and get turbulent; on hitting the ground they
 *           fan out briefly as a wall jet.
 *  - tire:  burnout smoke. Slow and buoyant.
 *  - haze:  optional ambient puffs (HAZE_COUNT, off by default). Survives clear().
 */
const MAX = 14000;
const KIND = { jet: 0, tire: 1, haze: 2 } as const;
const WIND = new THREE.Vector3(0.45, 0, 0.12);
/** Ambient haze puffs. Off: the smoke is there to show where gas comes from, not mood. */
const HAZE_COUNT = 0;
const HAZE_BOX = { x0: -40, x1: 40, y0: 0.5, y1: 9, z0: -14, z1: 16 };

export interface JetEmitter {
  origin: THREE.Vector3;
  /** Unit direction the gas leaves in (world). */
  dir: THREE.Vector3;
  /** Vehicle velocity — the gas inherits it. */
  carry: THREE.Vector3;
  /** Thruster force as a fraction of its rating. */
  throttle: number;
}

export class Smoke {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  // Simulation state.
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private growth = new Float32Array(MAX);
  private alpha0 = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private buoy = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private variant = new Uint8Array(MAX);
  private grounded = new Uint8Array(MAX);
  private next = HAZE_COUNT;
  private carryOver = new Map<string, number>();
  private time = 0;
  // Per-instance GPU attributes, written in sorted order.
  private iPos = new Float32Array(MAX * 3);
  private iData = new Float32Array(MAX * 4); // size, alpha, rotation, kind
  private iExtra = new Float32Array(MAX * 2); // heat, variant
  private order = new Uint32Array(MAX);
  private depth = new Float32Array(MAX);
  /** Multiplier on how much smoke is emitted (0 = none). */
  amount = 1;

  constructor() {
    this.geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.iPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iData', new THREE.InstancedBufferAttribute(this.iData, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute(
      'iExtra',
      new THREE.InstancedBufferAttribute(this.iExtra, 2).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, smokeMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.seedHaze();
  }

  /** Remove everything except the ambient haze (used when scrubbing or looping). */
  clear() {
    for (let i = HAZE_COUNT; i < MAX; i++) this.life[i] = 0;
    this.carryOver.clear();
  }

  emitJet(key: string, e: JetEmitter, dt: number) {
    if (e.throttle < 0.02) return;
    const n = this.count(key, 380 * this.amount * e.throttle * dt);
    const speed = 42 * Math.sqrt(Math.min(e.throttle, 1.2));
    for (let k = 0; k < n; k++) {
      const i = this.alloc(KIND.jet);
      const spread = 0.07;
      const s = speed * (0.8 + 0.4 * Math.random());
      const f = Math.random() * dt;
      const vx = e.carry.x + (e.dir.x + gauss() * spread) * s;
      const vy = e.carry.y + (e.dir.y + gauss() * spread) * s;
      const vz = e.carry.z + (e.dir.z + gauss() * spread) * s;
      this.set(i, e.origin.x + vx * f, e.origin.y + vy * f, e.origin.z + vz * f, vx, vy, vz);
      this.life[i] = 0.5 + 0.3 * Math.random(); // short-lived: shows where the gas comes from
      this.size[i] = 0.08 + 0.04 * Math.random();
      this.growth[i] = 0.22; // plume half-angle ~ 6°: width grows with distance travelled
      this.alpha0[i] = 0.3;
      this.drag[i] = 7.5;
      this.buoy[i] = -0.15; // cold nitrogen is slightly denser than air
    }
  }

  emitTire(key: string, origin: THREE.Vector3, carry: THREE.Vector3, intensity: number, dt: number) {
    const n = this.count(key, 60 * this.amount * intensity * dt);
    for (let k = 0; k < n; k++) {
      const i = this.alloc(KIND.tire);
      const a = Math.random() * Math.PI * 2;
      const vx = carry.x * 0.35 + Math.cos(a) * 1.4;
      const vz = carry.z * 0.35 + Math.sin(a) * 1.4;
      this.set(i, origin.x + gauss() * 0.15, origin.y, origin.z + gauss() * 0.15, vx, 0.6 + Math.random() * 0.8, vz);
      this.life[i] = 1.2 + Math.random() * 0.6;
      this.size[i] = 0.4 + 0.25 * Math.random();
      this.growth[i] = 0.5;
      this.alpha0[i] = 0.3;
      this.drag[i] = 1.6;
      this.buoy[i] = 0.55;
    }
  }

  /** A ring of ground dust/gas, e.g. the instant of touchdown. */
  burst(origin: THREE.Vector3, count: number, speed: number) {
    const n = Math.round(count * this.amount);
    for (let k = 0; k < n; k++) {
      const i = this.alloc(KIND.tire);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random());
      this.set(i, origin.x, 0.12, origin.z, Math.cos(a) * s, 0.3 + Math.random() * 0.5, Math.sin(a) * s);
      this.life[i] = 0.7 + Math.random() * 0.4;
      this.size[i] = 0.5;
      this.growth[i] = 0.5;
      this.alpha0[i] = 0.2;
      this.drag[i] = 2.5;
      this.buoy[i] = 0.25;
    }
  }

  /** Advance the simulation by dt (simulation seconds; 0 when paused) and upload sorted instances. */
  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    if (dt > 0) this.step(dt);
    this.upload(camera);
  }

  private step(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const j = i * 3;
      const kind = this.kind[i];
      if (kind === KIND.haze) {
        this.pos[j] += WIND.x * 0.6 * dt;
        this.pos[j + 2] += WIND.z * 0.6 * dt;
        if (this.pos[j] > HAZE_BOX.x1) this.pos[j] = HAZE_BOX.x0;
        if (this.pos[j + 2] > HAZE_BOX.z1) this.pos[j + 2] = HAZE_BOX.z0;
        continue;
      }
      const u = this.age[i] / this.life[i];
      // Relax toward the wind (entrainment), exactly integrated for stability.
      const k = Math.exp(-this.drag[i] * dt);
      const rx = this.vel[j] - WIND.x,
        ry = this.vel[j + 1],
        rz = this.vel[j + 2] - WIND.z;
      const relSpeed = Math.hypot(rx, ry, rz);
      this.vel[j] = WIND.x + rx * k;
      this.vel[j + 1] = ry * k + this.buoy[i] * (1 - u) * dt;
      this.vel[j + 2] = WIND.z + rz * k;
      // Turbulence grows as the plume slows and mixes.
      const turb = (kind === KIND.jet ? 7 : 1.6) * Math.min(1, this.age[i] * 2.5);
      const [nx, ny, nz] = curlish(this.pos[j], this.pos[j + 1], this.pos[j + 2], this.time + i * 0.013);
      this.vel[j] += nx * turb * dt;
      this.vel[j + 1] += ny * turb * dt * 0.6;
      this.vel[j + 2] += nz * turb * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;

      // Width grows with distance travelled through the air, plus slow diffusion.
      this.size[i] += this.growth[i] * relSpeed * dt * (kind === KIND.jet ? 1 : 0.15) + this.growth[i] * 0.35 * dt;

      const floor = 0.05 + this.size[i] * 0.15;
      if (this.pos[j + 1] < floor) {
        this.pos[j + 1] = floor;
        if (this.vel[j + 1] < 0) {
          // Jet hits the road: vertical momentum turns into a radial wall jet.
          const v = -this.vel[j + 1];
          let hx = this.vel[j],
            hz = this.vel[j + 2];
          const h = Math.hypot(hx, hz);
          if (h < 0.3 * v) {
            const a = Math.random() * Math.PI * 2;
            hx = Math.cos(a);
            hz = Math.sin(a);
          } else {
            hx /= h;
            hz /= h;
          }
          this.vel[j] += hx * v * 0.75;
          this.vel[j + 2] += hz * v * 0.75;
          this.vel[j + 1] = v * 0.08;
          if (!this.grounded[i]) {
            this.grounded[i] = 1;
            this.life[i] += 0.3 + 0.3 * Math.random();
            this.growth[i] *= 1.3;
            this.drag[i] = 2.2;
            this.buoy[i] = 0.2;
          }
        }
      }
      this.rot[i] += this.spin[i] * dt;
    }
  }

  private upload(camera: THREE.Camera) {
    const view = camera.matrixWorldInverse.elements;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue;
      const j = i * 3;
      // View-space z (negative in front of the camera).
      this.depth[i] = view[2] * this.pos[j] + view[6] * this.pos[j + 1] + view[10] * this.pos[j + 2] + view[14];
      this.order[n++] = i;
    }
    const idx = this.order.subarray(0, n);
    idx.sort((a, b) => this.depth[a] - this.depth[b]); // farthest (most negative) first
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const j = i * 3;
      this.iPos[k * 3] = this.pos[j];
      this.iPos[k * 3 + 1] = this.pos[j + 1];
      this.iPos[k * 3 + 2] = this.pos[j + 2];
      const u = this.age[i] / this.life[i];
      const fadeIn = this.kind[i] === KIND.haze ? Math.min(this.amount, 1) : Math.min(1, u * 14);
      this.iData[k * 4] = this.size[i];
      this.iData[k * 4 + 1] = this.alpha0[i] * fadeIn * Math.pow(1 - u, 1.4);
      this.iData[k * 4 + 2] = this.rot[i];
      this.iData[k * 4 + 3] = this.kind[i];
      this.iExtra[k * 2] = this.kind[i] === KIND.jet ? Math.exp(-this.age[i] / 0.09) : 0;
      this.iExtra[k * 2 + 1] = this.variant[i];
    }
    this.geo.instanceCount = n;
    for (const name of ['iPos', 'iData', 'iExtra']) {
      const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private seedHaze() {
    for (let i = 0; i < HAZE_COUNT; i++) {
      const b = HAZE_BOX;
      this.kind[i] = KIND.haze;
      this.pos[i * 3] = b.x0 + Math.random() * (b.x1 - b.x0);
      this.pos[i * 3 + 1] = b.y0 + Math.random() * (b.y1 - b.y0);
      this.pos[i * 3 + 2] = b.z0 + Math.random() * (b.z1 - b.z0);
      this.age[i] = 0;
      this.life[i] = Infinity;
      this.size[i] = 9 + Math.random() * 9;
      this.alpha0[i] = 0.006 + Math.random() * 0.006;
      this.rot[i] = Math.random() * Math.PI * 2;
      this.variant[i] = i % 4;
    }
  }

  private count(key: string, exact: number): number {
    const total = exact + (this.carryOver.get(key) ?? 0);
    const n = Math.floor(total);
    this.carryOver.set(key, total - n);
    return n;
  }

  private alloc(kind: number): number {
    const i = this.next;
    this.next = this.next + 1 >= MAX ? HAZE_COUNT : this.next + 1;
    this.kind[i] = kind;
    this.age[i] = 0;
    this.grounded[i] = 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 0.8;
    this.variant[i] = (Math.random() * 4) | 0;
    return i;
  }

  private set(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
  }
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}

/** Cheap divergence-free-ish swirl field from crossed sine waves. */
function curlish(x: number, y: number, z: number, t: number): [number, number, number] {
  const a = Math.sin(1.7 * y + 0.9 * t) + Math.sin(2.3 * z - 1.3 * t);
  const b = Math.sin(1.9 * z + 1.1 * t) + Math.sin(2.1 * x + 0.7 * t);
  const c = Math.sin(1.5 * x - 1.2 * t) + Math.sin(2.7 * y + 0.8 * t);
  return [a * 0.5, b * 0.5, c * 0.5];
}

/** 2×2 atlas of fractal puffs: density in alpha, generated once. */
function puffAtlas(): THREE.DataTexture {
  const cell = 128,
    size = cell * 2;
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number, s: number) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const noise = (x: number, y: number, s: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const u = xf * xf * (3 - 2 * xf),
      v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s),
      b = hash(xi + 1, yi, s),
      c = hash(xi, yi + 1, s),
      d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * cell,
      oy = Math.floor(v / 2) * cell;
    for (let py = 0; py < cell; py++)
      for (let px = 0; px < cell; px++) {
        const x = (px + 0.5) / cell - 0.5,
          y = (py + 0.5) / cell - 0.5;
        let f = 0,
          amp = 0.5,
          freq = 4;
        for (let o = 0; o < 5; o++) {
          f += amp * noise(x * freq + 10 * v, y * freq - 7 * v, v);
          amp *= 0.5;
          freq *= 2.1;
        }
        const r = Math.hypot(x, y) * 2;
        const fall = Math.max(0, 1 - r * r);
        const dens = Math.min(1, Math.max(0, fall * fall * (0.45 + 0.9 * f) - 0.06));
        const k = ((oy + py) * size + ox + px) * 4;
        data[k] = data[k + 1] = data[k + 2] = 255;
        data[k + 3] = Math.round(dens * 255);
      }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      puff: { value: puffAtlas() },
      fogColor: { value: new THREE.Color(FOG.color) },
      fogDensity: { value: FOG.density },
      ledZ: { value: LED_STRIP.z },
      ledX: { value: new THREE.Vector2(LED_STRIP.x0, LED_STRIP.x1) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 iPos;
      attribute vec4 iData;   // size, alpha, rotation, kind
      attribute vec2 iExtra;  // heat, variant
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlpha;
      varying float vKind;
      varying float vHeat;
      varying float vSize;
      varying float vDist;
      varying vec2 vCell;
      void main() {
        float c = cos(iData.z), s = sin(iData.z);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = iPos + (right * q.x + up * q.y) * iData.x;
        vUv = position.xy + 0.5;
        float v = iExtra.y;
        vCell = vec2(mod(v, 2.0), floor(v / 2.0)) * 0.5;
        vWorld = world;
        vAlpha = iData.y;
        vKind = iData.w;
        vHeat = iExtra.x;
        vSize = iData.x;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D puff;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform float ledZ;
      uniform vec2 ledX;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vAlpha;
      varying float vKind;
      varying float vHeat;
      varying float vSize;
      varying float vDist;
      varying vec2 vCell;
      float dens(vec2 uv) { return texture2D(puff, vCell + clamp(uv, 0.01, 0.99) * 0.5).a; }
      void main() {
        float d = dens(vUv);
        if (d < 0.004) discard;
        // Fake self-shadowing: floodlights are above, so denser puff overhead means shade.
        float above = dens(vUv + vec2(0.0, 0.12));
        float lit = clamp(0.75 + (d - above) * 1.6, 0.35, 1.15);
        float height = smoothstep(-0.5, 5.0, vWorld.y);
        // Cold-gas condensation picks up the cyan floodlights; tire smoke is neutral.
        vec3 base = vKind < 0.5 ? vec3(0.66, 0.84, 1.0) : (vKind < 1.5 ? vec3(0.86, 0.85, 0.87) : vec3(0.55, 0.68, 0.78));
        vec3 col = base * (0.16 + 0.84 * lit * (0.55 + 0.45 * height));
        // Red LED strip bounce on low smoke near the stage front.
        float inX = smoothstep(ledX.x - 3.0, ledX.x, vWorld.x) * (1.0 - smoothstep(ledX.y, ledX.y + 3.0, vWorld.x));
        float red = exp(-max(vWorld.y, 0.0) / 0.9) * exp(-abs(vWorld.z - ledZ) / 2.5) * inX;
        col += vec3(1.0, 0.1, 0.13) * 1.6 * red;
        // Fresh jet gas glows at the nozzle (bright enough to reach the bloom knee).
        col += vec3(0.7, 0.9, 1.0) * 2.2 * vHeat;
        float a = d * vAlpha;
        // Soften where the billboard cuts into the ground.
        a *= smoothstep(0.0, 0.3 * vSize, vWorld.y);
        // Fade puffs out as the camera reaches them, instead of popping when it passes through.
        a *= smoothstep(0.3, 0.3 + vSize, vDist);
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
        col = mix(col, fogColor, fog);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
}
