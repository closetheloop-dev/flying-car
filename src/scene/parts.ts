import * as THREE from 'three';
import { dim, glowStrip, hdr } from './glow';
import { loftBody, type BodySpec, type Surface, SURFACES } from './loft';

export const MAT = {
  tire: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.82 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.85, roughness: 0.32 }),
  rimFace: new THREE.MeshStandardMaterial({ color: 0x3b3e44, metalness: 0.9, roughness: 0.25 }),
  // Fallback for the 'glass' surface group. Windows are normally drawn per pixel by
  // paintWithGlass instead, so no current classifier assigns this group.
  glass: new THREE.MeshStandardMaterial({ color: 0x040507, metalness: 0.1, roughness: 0.12 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.55, metalness: 0.2 }),
  under: new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.7, metalness: 0.35 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.65, metalness: 0.4 }),
  // Light colors, scaled by luminance so each one glows (see hdr in glow.ts).
  head: new THREE.MeshBasicMaterial({ color: hdr(0xeef3ff, 1.5) }),
  tail: new THREE.MeshBasicMaterial({ color: hdr(0xff1428, 1.3) }),
  marker: new THREE.MeshBasicMaterial({ color: hdr(0xff8a1a, 1.1) }),
};

/**
 * Clearcoated paint. The clearcoat is deliberately not mirror-smooth: with point-like
 * floodlights a near-zero roughness makes sub-pixel glints far brighter than the bloom
 * threshold, and they pulse (flicker) as the camera moves.
 */
export function paint(
  color: number,
  opts: Partial<THREE.MeshPhysicalMaterialParameters> = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.45,
    roughness: 0.36,
    clearcoat: 1,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.2,
    ...opts,
  });
}

/** A lofted body with one material per surface group. */
export function bodyMesh(
  spec: BodySpec,
  paintMat: THREE.Material,
  overrides: Partial<Record<Surface, THREE.Material>> = {},
): THREE.Mesh {
  const mats: Record<Surface, THREE.Material> = {
    paint: paintMat,
    glass: MAT.glass,
    trim: MAT.trim,
    under: MAT.under,
    light: MAT.head,
    ...overrides,
  };
  const mesh = new THREE.Mesh(
    loftBody(spec),
    SURFACES.map((s) => mats[s]),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Tire (lathed rounded section) plus an aero wheel cover with a shallow turbine
 * pattern. Axle along z; rotate the group about z to spin it.
 */
export function wheel(radius: number, width: number, opts: { dual?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const rimR = radius * 0.66;
  const c = Math.min(width * 0.28, radius * 0.12);
  const prof: THREE.Vector2[] = [];
  const hw = width / 2;
  prof.push(new THREE.Vector2(rimR, -hw * 0.92));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    prof.push(new THREE.Vector2(radius - c + c * Math.cos(a), -hw + c + c * Math.sin(a)));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push(new THREE.Vector2(radius - c + c * Math.cos(a), hw - c + c * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(rimR, hw * 0.92));
  const tireGeo = new THREE.LatheGeometry(prof, 48);
  tireGeo.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, MAT.tire);
  tire.castShadow = true;
  g.add(tire);

  // Dished cover: slightly concave disc on each face.
  for (const side of [-1, 1]) {
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.96, 0.03, 40), MAT.rim);
    dish.rotation.x = Math.PI / 2;
    dish.position.z = side * hw * 0.8;
    g.add(dish);
    const vanes = 10;
    const vaneGeo = new THREE.BoxGeometry(rimR * 0.62, rimR * 0.07, 0.012);
    for (let k = 0; k < vanes; k++) {
      const v = new THREE.Mesh(vaneGeo, MAT.rimFace);
      const a = (k / vanes) * Math.PI * 2;
      v.position.set(Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5, side * (hw * 0.8 + 0.017));
      v.rotation.z = a + 0.5;
      g.add(v);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.18, rimR * 0.18, 0.02, 20), MAT.rimFace);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = side * (hw * 0.8 + 0.02);
    g.add(hub);
  }
  if (opts.dual) {
    const inner = tire.clone();
    inner.position.z = -width * 1.05;
    g.add(inner);
  }
  return g;
}

/** Thin emissive strip, centred at (x, y, z), long axis along z unless rotated. */
const lenses = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();

/**
 * A light strip centered at (x, y, z), long axis along z unless rotated. The light
 * itself is a band-limited glowStrip (see glow.ts) so it cannot flicker; the solid bar
 * underneath is a dim lens, below the bloom threshold, for close-up views.
 * `outward` is the direction the strip faces (default: away from the vehicle's center
 * along x), so the glow sits just outside the lens rather than inside the body.
 */
export function strip(
  mat: THREE.MeshBasicMaterial,
  x: number,
  y: number,
  z: number,
  length: number,
  height = 0.025,
  depth = 0.02,
  outward: [number, number, number] = [Math.sign(x) || 1, 0, 0],
): THREE.Object3D {
  let lens = lenses.get(mat);
  if (!lens) {
    lens = new THREE.MeshBasicMaterial({ color: dim(mat.color) });
    lenses.set(mat, lens);
  }
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(depth, height, length), lens));
  const glow = glowStrip(mat.color, length, height);
  const half = [depth / 2, height / 2, length / 2];
  glow.position.set(...(outward.map((o, i) => o * (half[i] + 0.004)) as [number, number, number]));
  g.add(glow);
  return g;
}

/**
 * Paint whose windows are decided per pixel rather than per triangle, so window
 * outlines are crisp and can be any shape regardless of mesh density.
 *
 * `inside` is a GLSL function body over object-space position `p` and normal `n`
 * returning a signed distance-like value: > 0 inside a window, < 0 outside. Build
 * it from min() (intersection) and max() (union) of half-space distances; the edge
 * is antialiased with fwidth.
 */
export function paintWithGlass(base: THREE.MeshPhysicalMaterial, inside: string): THREE.MeshPhysicalMaterial {
  base.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObjPos;
varying vec3 vObjNormal;
float glassInside(vec3 p, vec3 n) { ${inside} }
float glassMask() {
  float d = glassInside(vObjPos, normalize(vObjNormal));
  return clamp(d / max(fwidth(d), 1e-4) + 0.5, 0.0, 1.0);
}`,
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat gMask = glassMask();\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.010, 0.012, 0.016), gMask);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, gMask);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.1, gMask);',
      )
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= 1.0 - gMask;\n#endif',
      );
  };
  base.customProgramCacheKey = () => inside;
  return base;
}
