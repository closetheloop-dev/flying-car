import * as THREE from 'three';

/**
 * Band-limited light strips. Thin emissive bars (2–4 cm) are sub-pixel at normal
 * viewing distances, so as the camera moves they alternately cover a pixel row or
 * vanish — and bloom amplifies that blinking into visible flicker. A GlowStrip is
 * drawn instead as a screen-space line with a soft (Gaussian) cross-section at least
 * MIN_PX wide; when widened beyond its true projected thickness it is dimmed in
 * proportion, so its integrated brightness stays constant and it cannot blink.
 */

/** Drawing-buffer size in pixels; main.ts keeps this in sync on resize. */
export const GLOW_RESOLUTION = new THREE.Vector2(1, 1);

/**
 * Bloom threshold in linear luminance. Lit (PBR) surfaces are capped below it (see
 * main.ts), so only emissive lights glow.
 */
export const BLOOM_THRESHOLD = 2.0;

/**
 * An emissive color scaled so its luminance is `k` × the bloom threshold. Scaling by
 * luminance rather than by a fixed factor matters for saturated lights: red carries
 * only ~21% of white's luminance, so a fixed multiplier leaves red and amber far
 * below the threshold and they never glow.
 */
export function hdr(hex: number, k = 1.5): THREE.Color {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.multiplyScalar((k * BLOOM_THRESHOLD) / Math.max(lum, 1e-4));
}

/** The same hue at a modest, unbloomed brightness (max channel 0.9), for lenses. */
export function dim(c: THREE.Color): THREE.Color {
  return c.clone().multiplyScalar(0.9 / Math.max(c.r, c.g, c.b, 1e-4));
}

const MIN_PX = 2.5;

function quad(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // corner.x: 0 at the start, 1 at the end; corner.y: −1 / +1 across the line.
  g.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 1, 1, 0, 1], 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * A glowing segment along local z, centered on the origin, `length` long and
 * `thickness` tall in world units. Position and rotate it like any Object3D.
 */
export function glowStrip(color: THREE.Color, length: number, thickness: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uStart: { value: new THREE.Vector3(0, 0, -length / 2) },
      uEnd: { value: new THREE.Vector3(0, 0, length / 2) },
      uThickness: { value: thickness },
      uColor: { value: color },
      uResolution: { value: GLOW_RESOLUTION },
      uMinPx: { value: MIN_PX },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uStart;
      uniform vec3 uEnd;
      uniform float uThickness;
      uniform vec2 uResolution;
      uniform float uMinPx;
      attribute vec2 corner;
      varying float vAcross;
      varying float vAlongPx;
      varying float vLenPx;
      varying float vWidthPx;
      varying float vGain;
      void main() {
        vec4 a = projectionMatrix * modelViewMatrix * vec4(uStart, 1.0);
        vec4 b = projectionMatrix * modelViewMatrix * vec4(uEnd, 1.0);
        if (a.w < 0.05 || b.w < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec2 halfRes = 0.5 * uResolution;
        vec2 pa = a.xy / a.w * halfRes, pb = b.xy / b.w * halfRes;
        vec2 d = pb - pa;
        float len = length(d);
        vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        vec4 clip = mix(a, b, corner.x);
        // True thickness in pixels at this depth, and the (possibly widened) drawn width.
        float pxPerUnit = halfRes.y * projectionMatrix[1][1] / clip.w;
        float thickPx = uThickness * pxPerUnit;
        float widthPx = max(thickPx, uMinPx);
        vGain = thickPx / widthPx;
        vWidthPx = widthPx;
        float halfSpan = 1.5 * widthPx;        // room for the soft falloff
        float cap = 0.75 * widthPx;            // soft end caps
        vec2 p = mix(pa, pb, corner.x) + perp * corner.y * halfSpan + dir * (corner.x * 2.0 - 1.0) * cap;
        vAcross = corner.y * halfSpan / (0.5 * widthPx);   // in half-widths: ±3
        vAlongPx = corner.x * (len + 2.0 * cap) - cap;
        vLenPx = len;
        gl_Position = vec4(p / halfRes * clip.w, clip.z, clip.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAcross;
      varying float vAlongPx;
      varying float vLenPx;
      varying float vWidthPx;
      varying float vGain;
      void main() {
        // Gaussian cross-section with full width at half maximum = the drawn width.
        float k = exp(-vAcross * vAcross * 0.6931);
        float ends = clamp(min(vAlongPx, vLenPx - vAlongPx) / (0.5 * vWidthPx) + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(uColor * (k * ends * vGain), 1.0);
      }`,
  });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.userData.owned = true; // freed with its mesh (see disposeTree in main.ts)
  const mesh = new THREE.Mesh(quad(), mat);
  mesh.userData.glow = true; // toggled from the Display panel (see main.ts applyDisplay)
  mesh.frustumCulled = false; // the vertex shader places the quad; the dummy positions have no extent
  mesh.renderOrder = 7;
  return mesh;
}
