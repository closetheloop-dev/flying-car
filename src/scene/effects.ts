import * as THREE from 'three';

/**
 * Nozzle force drawn as a full-size plume [N]. Scaling by force rather than by each
 * nozzle's rating keeps the sustained ~2 kN lift jets clearly visible, as in the
 * footage, while the launch burn (~13 kN per nozzle) still draws much larger.
 */
export const PLUME_REF_FORCE = 12_000;

/** 0 … 1.2 visual throttle for a nozzle force [N]. */
export const plumeLevel = (force: number): number => Math.min(force / PLUME_REF_FORCE, 1.2);

/**
 * Bright collimated core of each cold-gas jet, right at the nozzle (in the footage
 * the plumes are tight blue-white columns before they break up into billows; the
 * billows are particles in smoke.ts). Length scales with √throttle, like the jet's
 * momentum flux. Points along the nozzle's local −y (see buildStuntCar).
 */
export class Plumes {
  private cones: THREE.Mesh[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private time = 0;

  constructor(nozzles: THREE.Object3D[]) {
    const geo = new THREE.CylinderGeometry(0.06, 0.32, 1, 24, 12, true);
    geo.translate(0, -0.5, 0);
    for (const n of nozzles) {
      const mat = jetMaterial();
      const cone = new THREE.Mesh(geo, mat);
      cone.visible = false;
      cone.renderOrder = 6;
      n.add(cone);
      this.cones.push(cone);
      this.mats.push(mat);
    }
  }

  update(forces: number[], dt: number) {
    this.time += dt;
    forces.forEach((f, i) => {
      const frac = plumeLevel(f);
      const cone = this.cones[i];
      cone.visible = frac > 0.02;
      const len = 0.8 + 4.0 * Math.sqrt(frac); // ≈2.4 m sustained, ≈5 m at launch, as in the footage
      cone.scale.set(0.7 + 0.5 * frac, len, 0.7 + 0.5 * frac);
      this.mats[i].uniforms.strength.value = 0.35 + 0.65 * Math.min(frac, 1);
      this.mats[i].uniforms.time.value = this.time + i * 1.7;
    });
  }
}

function jetMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { strength: { value: 0 }, time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vEdge;
      varying vec2 vRadial;
      void main() {
        vAlong = -position.y;            // 0 at the nozzle, 1 at the far end
        vRadial = position.xz;           // angle is taken per pixel: interpolating atan() wraps at ±π
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normalize(vec3(position.x, 0.0, position.z)));
        vEdge = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float strength;
      uniform float time;
      varying float vAlong;
      varying float vEdge;
      varying vec2 vRadial;
      void main() {
        float around = atan(vRadial.y, vRadial.x);
        // Shock-cell-like banding near the nozzle, turbulent flicker further out.
        // Integer angular frequencies keep the pattern continuous all the way round.
        float bands = 0.75 + 0.25 * sin(vAlong * 38.0 - time * 60.0);
        float flicker = 0.7 + 0.3 * sin(around * 5.0 + vAlong * 9.0 - time * 23.0)
                            * sin(around * 3.0 - vAlong * 13.0 + time * 17.0);
        float core = pow(vEdge, 1.8);
        float fade = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.04, vAlong);
        float a = strength * core * fade * mix(bands, flicker, smoothstep(0.1, 0.5, vAlong));
        gl_FragColor = vec4(vec3(0.62, 0.84, 1.0) * a * 1.6, 1.0);
      }`,
  });
  mat.userData.owned = true; // one per nozzle per build; freed with the car (main.ts disposeTree)
  return mat;
}
