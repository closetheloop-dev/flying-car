import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

/**
 * The vehicle models from compressed-glbs/ (meshopt-compressed GLBs with WebP textures),
 * prepared for this scene on load:
 *  - windows are tinted dark and opaque, and everything that can't be seen from outside
 *    (the interiors behind them) is removed;
 *  - meshes that are still heavy are simplified;
 *  - the model is normalized: nose along +x, up +y, ground at y = 0, centered, and scaled
 *    uniformly to a given length; the Roadster's wheels are separated so they can spin.
 * The procedural models stand in until these load (or if they can't).
 */
export type ModelKind = 'roadster' | 'model3' | 'modelY' | 'cybertruck' | 'semi' | 'cybercab';

interface ModelSpec {
  url: string;
  /** Which way the nose points in the file. */
  nose: '+x' | '+z';
  /** The tire treads (they locate the wheels), and the meshes whose wheel parts should spin. */
  wheels?: { tires: RegExp; parts: RegExp };
  /** Meshes whose underside (low, downward-facing triangles) gets the lighter UNDERSIDE material. */
  underside?: RegExp;
  /** Meshes repainted with a solid paint color (the model's own palette color is wrong). */
  paint?: { meshes: RegExp; color: number };
}

const SPECS: Record<ModelKind, ModelSpec> = {
  roadster: {
    url: new URL('../../compressed-glbs/tesla_roadster_2020.glb', import.meta.url).href,
    nose: '+z',
    wheels: { tires: /Thread/, parts: /Rims|Thread|Sidewall/ },
    underside: /Rims/,
    // Gloss white, as in the footage (the model's paint is a dark metallic silver).
    paint: { meshes: /main_paint/, color: 0xf3f4f5 },
  },
  model3: { url: new URL('../../compressed-glbs/tesla_model__3_2024.glb', import.meta.url).href, nose: '+x' },
  modelY: { url: new URL('../../compressed-glbs/2025_tesla_model_y.glb', import.meta.url).href, nose: '+z' },
  cybertruck: { url: new URL('../../compressed-glbs/tesla_cybertruck.glb', import.meta.url).href, nose: '+z' },
  semi: { url: new URL('../../compressed-glbs/tesla_semi.glb', import.meta.url).href, nose: '+z' },
  cybercab: { url: new URL('../../compressed-glbs/cybercab-generated.glb', import.meta.url).href, nose: '+x' },
};

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const templates = new Map<ModelKind, Promise<THREE.Group>>();
let renderer: THREE.WebGLRenderer | null = null;

/** Wheel pivots in a model, front-left, front-right, rear-left, rear-right (body +z is right). */
export const WHEEL_NAMES = ['wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR'];

/** The renderer used to find what is visible from outside (needed before loading). */
export function setModelRenderer(r: THREE.WebGLRenderer) {
  renderer = r;
}

/** The loaded, prepared model at unit scale (1 = as authored), shared by all instances. */
function template(kind: ModelKind): Promise<THREE.Group> {
  let t = templates.get(kind);
  if (!t) {
    const spec = SPECS[kind];
    t = loader.loadAsync(spec.url).then(async (gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      if (spec.paint) repaint(scene, spec.paint);
      const clear = prepareGlass(scene);
      await removeHidden(scene, clear);
      await simplifyHeavyMeshes(scene);
      return normalize(scene, spec);
    });
    templates.set(kind, t);
  }
  return t;
}

/** Start loading every model now (they are fetched in parallel). */
export function preloadModels(): void {
  (Object.keys(SPECS) as ModelKind[]).forEach((k) => template(k).catch(() => {}));
}

/**
 * A copy of the model, scaled uniformly to `length` along +x. Geometry, materials and
 * textures are shared with the template (and every other copy): don't dispose them.
 */
export async function modelInstance(kind: ModelKind, length: number): Promise<THREE.Group> {
  const t = await template(kind);
  const copy = t.clone(true);
  const s = length / (t.userData.length as number);
  copy.scale.setScalar(s);
  copy.traverse((o) => {
    o.userData.shared = true;
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false; // the proxy below casts it, for a fraction of the triangles
      o.receiveShadow = true;
    }
  });
  copy.add(shadowProxy(t));
  return copy;
}

/** An invisible box the size of the model that only casts its shadow. */
const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function shadowProxy(t: THREE.Group): THREE.Mesh {
  const { length, height, width } = t.userData as { length: number; height: number; width: number };
  const box = new THREE.Mesh(new THREE.BoxGeometry(length * 0.96, height * 0.85, width * 0.9), proxyMaterial);
  box.position.y = height * 0.5;
  box.castShadow = true;
  box.userData.shared = true;
  box.userData.shadowProxy = true; // copies of the car for ghosts leave it out
  return box;
}

// ── Glass ─────────────────────────────────────────────────────────────────

/** Dark tinted window glass: opaque, so whatever was behind it can go. */
const TINTED = new THREE.MeshStandardMaterial({
  name: 'tinted glass',
  color: 0x0b0e12,
  metalness: 0.6,
  roughness: 0.06,
});

/** Solid clear-coated paint in place of the model's (textured, fully metallic) paint. */
function repaint(scene: THREE.Object3D, { meshes, color }: { meshes: RegExp; color: number }) {
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'paint',
    color,
    metalness: 0.05,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && meshes.test(o.name)) (o as THREE.Mesh).material = mat;
  });
}

function surfaceArea(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const idx = mesh.geometry.index;
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
}

/**
 * Windows become dark tinted glass. Glass is any see-through material (transmission, or
 * blending), or a mesh named as glass; it is a window if it is large (light covers are
 * small, and stay clear but plain-transparent: transmission would render the scene twice).
 * Returns the clear glass meshes, which don't hide what is behind them.
 */
function prepareGlass(scene: THREE.Object3D): Set<THREE.Mesh> {
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  const scale2 = Math.max(size.x, size.y, size.z) ** 2;
  const clear = new Set<THREE.Mesh>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshPhysicalMaterial;
    const seeThrough = m.transmission > 0 || m.transparent || m.opacity < 1;
    const named = /glass/i.test(mesh.name) && !/seal/i.test(mesh.name);
    if (!seeThrough && !named) return;
    if (surfaceArea(mesh) / scale2 > 0.03) {
      mesh.material = TINTED;
      return;
    }
    if (m.transmission > 0) {
      const plain = m.clone();
      plain.opacity = Math.min(m.opacity, 1 - 0.75 * m.transmission);
      plain.transmission = 0;
      plain.transparent = true;
      plain.depthWrite = false;
      mesh.material = plain;
    }
    if (seeThrough) clear.add(mesh);
  });
  return clear;
}

// ── Hidden geometry ───────────────────────────────────────────────────────

/** Views (on a sphere around the model) and their resolution for the visibility test. */
const VIEWS = 48;
const VIEW_SIZE = 768;
/** Views rendered per animation frame, so the page keeps running while models are prepared. */
const VIEWS_PER_FRAME = 2;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Remove every triangle that can't be seen from outside the vehicle, from any direction
 * (from below too: the car flies upside down). Each triangle is drawn in its own color
 * from many directions, with the tinted windows as opaque as the body; triangles whose
 * color never shows are hidden — the interior behind the windows, and inner parts.
 * Clear glass (light covers) is kept and doesn't hide anything.
 */
async function removeHidden(scene: THREE.Object3D, clear: Set<THREE.Mesh>) {
  if (!renderer) return;
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !clear.has(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
  });
  const idScene = new THREE.Scene();
  const idMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const ranges: { mesh: THREE.Mesh; first: number; index: ArrayLike<number> }[] = [];
  let next = 1;
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = mesh.geometry.index ? mesh.geometry.index.array : Array.from({ length: pos.count }, (_, i) => i);
    const n = index.length;
    const positions = new Float32Array(n * 3);
    const colors = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, index[i])
        .applyMatrix4(mesh.matrixWorld)
        .toArray(positions, i * 3);
      const id = next + Math.floor(i / 3);
      colors[i * 3] = id & 255;
      colors[i * 3 + 1] = (id >> 8) & 255;
      colors[i * 3 + 2] = (id >> 16) & 255;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    idScene.add(new THREE.Mesh(g, idMaterial));
    ranges.push({ mesh, first: next, index });
    next += n / 3;
  }
  if (next > 0xffffff) return; // more triangles than colors: leave the model as it is

  const sphere = new THREE.Box3().setFromObject(idScene).getBoundingSphere(new THREE.Sphere());
  const R = sphere.radius;
  const camera = new THREE.OrthographicCamera(-R, R, R, -R, R * 0.5, R * 3.5);
  const target = new THREE.WebGLRenderTarget(VIEW_SIZE, VIEW_SIZE, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  const pixels = new Uint8Array(VIEW_SIZE * VIEW_SIZE * 4);
  const seen = new Uint8Array(next);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < VIEWS; k++) {
    // A few views per frame, between the app's own frames (which use the same renderer).
    if (k % VIEWS_PER_FRAME === 0) await nextFrame();
    // Evenly spread directions (a Fibonacci sphere).
    const y = 1 - (2 * (k + 0.5)) / VIEWS,
      r = Math.sqrt(1 - y * y),
      a = golden * k;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    camera.position.copy(sphere.center).addScaledVector(dir, R * 2);
    camera.up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.99) camera.up.set(1, 0, 0);
    camera.lookAt(sphere.center);
    const prevTarget = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(idScene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, VIEW_SIZE, VIEW_SIZE, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    for (let p = 0; p < pixels.length; p += 4) {
      const id = pixels[p] | (pixels[p + 1] << 8) | (pixels[p + 2] << 16);
      if (id) seen[id] = 1;
    }
  }
  target.dispose();
  idMaterial.dispose();
  idScene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());

  for (const { mesh, first, index } of ranges) {
    const kept: number[] = [];
    for (let t = 0; t < index.length / 3; t++) {
      if (seen[first + t]) kept.push(index[3 * t], index[3 * t + 1], index[3 * t + 2]);
    }
    if (!kept.length) {
      mesh.removeFromParent();
      continue;
    }
    if (kept.length === index.length) continue;
    const g = mesh.geometry.clone();
    g.setIndex(kept);
    mesh.geometry = g;
  }
}

// ── Simplification ────────────────────────────────────────────────────────

/** Meshes still above this many triangles are simplified. */
const HEAVY_TRIANGLES = 40_000;
/** Keep this share of a heavy mesh's triangles, within this geometric error (relative to the mesh size). */
const KEEP = 0.4;
const MAX_ERROR = 0.001;

/** Simplify each mesh that is still heavy with meshoptimizer, keeping its silhouette and borders. */
async function simplifyHeavyMeshes(scene: THREE.Object3D) {
  const heavy: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.index && m.geometry.index.count / 3 > HEAVY_TRIANGLES) heavy.push(m);
  });
  if (!heavy.length) return;
  await MeshoptSimplifier.ready;
  for (const mesh of heavy) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      positions[i * 3] = pos.getX(i);
      positions[i * 3 + 1] = pos.getY(i);
      positions[i * 3 + 2] = pos.getZ(i);
    }
    const indices = new Uint32Array(g.index!.array);
    const target = Math.floor((indices.length * KEEP) / 3) * 3;
    // Keep normals and texture coordinates too, so shading and textures don't smear across
    // creases and UV seams.
    const normal = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const stride = (normal ? 3 : 0) + (uv ? 2 : 0);
    let simplified: Uint32Array;
    if (stride) {
      const attrs = new Float32Array(pos.count * stride);
      for (let i = 0; i < pos.count; i++) {
        let o = i * stride;
        if (normal) {
          attrs[o++] = normal.getX(i);
          attrs[o++] = normal.getY(i);
          attrs[o++] = normal.getZ(i);
        }
        if (uv) {
          attrs[o++] = uv.getX(i);
          attrs[o++] = uv.getY(i);
        }
      }
      const weights = [...(normal ? [0.5, 0.5, 0.5] : []), ...(uv ? [1, 1] : [])];
      [simplified] = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        positions,
        3,
        attrs,
        stride,
        weights,
        null,
        target,
        MAX_ERROR,
        ['LockBorder'],
      );
    } else {
      [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target, MAX_ERROR, ['LockBorder']);
    }
    if (simplified.length >= indices.length * 0.95) continue; // not worth it
    const out = g.clone();
    out.setIndex(new THREE.BufferAttribute(simplified, 1));
    mesh.geometry = out;
  }
}

// ── Normalizing ───────────────────────────────────────────────────────────

function normalize(scene: THREE.Group, spec: ModelSpec): THREE.Group {
  // Turn the nose to +x: a +z nose needs a quarter turn about y.
  const turned = new THREE.Group();
  if (spec.nose === '+z') turned.rotation.y = Math.PI / 2;
  turned.add(scene);
  const root = new THREE.Group();
  root.add(turned);
  root.updateMatrixWorld(true);
  if (spec.wheels) splitWheels(root, spec.wheels);
  if (spec.underside) lightenUnderside(root, spec.underside);
  // Center the footprint and stand it on y = 0.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Group();
  offset.position.set(-c.x, -box.min.y, -c.z);
  for (const o of root.children.slice()) {
    // a copy: the loop empties root.children
    root.remove(o);
    offset.add(o);
  }
  const out = new THREE.Group();
  out.add(offset);
  out.userData.length = box.max.x - box.min.x;
  out.userData.height = box.max.y - box.min.y;
  out.userData.width = box.max.z - box.min.z;
  return out;
}

/**
 * Hang each wheel on its own pivot at its axle so it can spin. These models merge parts
 * that share a material into one mesh (a "rims" mesh also holds trim and interior parts),
 * so the wheels are found from the tire treads — one per quarter of the car — and only
 * the triangles inside each wheel's cylinder move to its pivot; the rest stay put. Works
 * in the root's frame (nose +x, right +z).
 */
function splitWheels(root: THREE.Group, spec: { tires: RegExp; parts: RegExp }) {
  const tires: THREE.Mesh[] = [],
    parts: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (spec.tires.test(m.name)) tires.push(m);
    if (spec.parts.test(m.name)) parts.push(m);
  });
  if (!tires.length) return;
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const mid = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  const quarter = (x: number, z: number) => (x < mid.x ? 2 : 0) + (z > mid.z ? 1 : 0); // FL, FR, RL, RR

  // Each wheel's extent, from its tire.
  const boxes = [0, 1, 2, 3].map(() => new THREE.Box3());
  const v = new THREE.Vector3();
  for (const tire of tires) {
    const pos = tire.geometry.getAttribute('position') as THREE.BufferAttribute;
    const m = new THREE.Matrix4().multiplyMatrices(rootInv, tire.matrixWorld);
    const idx = tire.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m);
      boxes[quarter(v.x, v.z)].expandByPoint(v);
    }
  }
  if (boxes.some((b) => b.isEmpty())) return;
  const wheels = boxes.map((b) => {
    const center = b.getCenter(new THREE.Vector3()),
      size = b.getSize(new THREE.Vector3());
    return {
      center,
      radius: (Math.max(size.x, size.y) / 2) * 1.03,
      halfWidth: size.z / 2 + 0.02 * Math.max(size.x, size.y),
    };
  });
  const inWheel = (p: THREE.Vector3) =>
    wheels.findIndex(
      (w) => Math.hypot(p.x - w.center.x, p.y - w.center.y) <= w.radius && Math.abs(p.z - w.center.z) <= w.halfWidth,
    );

  const pivots = wheels.map((w, q) => {
    const pivot = new THREE.Group();
    pivot.name = WHEEL_NAMES[q];
    pivot.position.copy(w.center);
    pivot.userData.radius = w.radius / 1.03; // the tire's, in model units (scaled with the model)
    root.add(pivot);
    return pivot;
  });
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (const mesh of parts) {
    const g = floatGeometry(mesh.geometry);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld));
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const index = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    const buckets: number[][] = [[], [], [], []];
    const stay: number[] = [];
    for (let i = 0; i < index.length; i += 3) {
      a.fromBufferAttribute(pos, index[i]);
      b.fromBufferAttribute(pos, index[i + 1]);
      c.fromBufferAttribute(pos, index[i + 2]);
      const qa = inWheel(a),
        qb = inWheel(b),
        qc = inWheel(c);
      const tri = [index[i], index[i + 1], index[i + 2]];
      if (qa >= 0 && qa === qb && qa === qc) buckets[qa].push(...tri);
      else stay.push(...tri);
    }
    buckets.forEach((idx, q) => {
      if (!idx.length) return;
      const part = g.clone();
      part.setIndex(idx);
      part.translate(-wheels[q].center.x, -wheels[q].center.y, -wheels[q].center.z);
      const piece = new THREE.Mesh(part, mesh.material);
      piece.name = `${WHEEL_NAMES[q]}-${mesh.name}`;
      pivots[q].add(piece);
    });
    if (stay.length) {
      // What isn't wheel stays where it was, now in the root's frame.
      const rest = g.clone();
      rest.setIndex(stay);
      const piece = new THREE.Mesh(rest, mesh.material);
      piece.name = mesh.name;
      root.add(piece);
    }
    mesh.removeFromParent();
  }
}

/**
 * The Roadster's underside (pan, rails and pack) is silvery and catches the floodlights in
 * the footage as it rolls over; the model's is fully metallic, so it can only mirror the
 * dark ground and renders near black. Its low, downward-facing triangles get a satin-metal
 * material that diffuse light can brighten, with a little emission standing in for the
 * low floodlights the scene doesn't have. Kept dim: the model's underside is a flat pan
 * without the footage's frame and pack detail, so it should read, not stand out. Only
 * meshes directly under the root (not the wheels on their pivots); works in the root's
 * frame (up +y).
 */
const UNDERSIDE = new THREE.MeshStandardMaterial({
  name: 'underside',
  color: 0x828284,
  metalness: 0.33,
  roughness: 0.5,
  emissive: 0x0e0f11,
});
function lightenUnderside(root: THREE.Group, names: RegExp) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const below = box.min.y + 0.4 * (box.max.y - box.min.y);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (const mesh of root.children) {
    const m = mesh as THREE.Mesh;
    if (!m.isMesh || !names.test(m.name)) continue;
    const g = m.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const index = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    const under: number[] = [],
      rest: number[] = [];
    for (let i = 0; i < index.length; i += 3) {
      a.fromBufferAttribute(pos, index[i]).applyMatrix4(m.matrix);
      b.fromBufferAttribute(pos, index[i + 1]).applyMatrix4(m.matrix);
      c.fromBufferAttribute(pos, index[i + 2]).applyMatrix4(m.matrix);
      const low = (a.y + b.y + c.y) / 3 < below;
      const n = b.sub(a).cross(c.sub(a)).normalize();
      (low && n.y < -0.3 ? under : rest).push(index[i], index[i + 1], index[i + 2]);
    }
    if (!under.length) continue;
    // Two groups on the one geometry: the rest keeps its material, the underside gets UNDERSIDE.
    g.setIndex([...rest, ...under]);
    g.clearGroups();
    g.addGroup(0, rest.length, 0);
    g.addGroup(rest.length, under.length, 1);
    m.material = [m.material as THREE.Material, UNDERSIDE];
  }
}

/** A copy of the geometry with float positions, normals and tangents (quantized ones can't be transformed in place). */
function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  for (const name of ['position', 'normal', 'tangent']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a || a.array instanceof Float32Array) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}
