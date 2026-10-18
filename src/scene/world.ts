import * as THREE from 'three';
import { LINEUP, LINEUP_Z, STAGE, type Obstacle } from '../physics/layout';
import { buildParked } from './parked';
import { hdr } from './glow';
import { strip } from './parts';

const RED = hdr(0xff1428, 1.3);

/** Scene fog, shared with the smoke shader (which applies its own fog). */
export const FOG = { color: 0x06080a, density: 0.007 };
/** The long red LED strip on the ground in front of the stage; smoke near it is tinted red. */
export const LED_STRIP = { x0: -18, x1: 14, z: STAGE.z0 - 0.9 };

/**
 * Night-time test lot as in the footage: asphalt, a lane line leading to the stage,
 * the five-vehicle line-up on a low stage edged with red LED strips, and floodlights.
 */
/** A parked vehicle in the scene, so its procedural model can be swapped for the GLB one. */
export interface ParkedVehicle {
  obstacle: Obstacle;
  group: THREE.Group;
}

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): ParkedVehicle[] {
  const parked: ParkedVehicle[] = [];
  scene.background = new THREE.Color(0x040506);
  scene.fog = new THREE.FogExp2(FOG.color, FOG.density);

  // Reflections: a night sky with the floodlights and LED strips in it, so glossy
  // paint picks up highlights while dark glass stays dark.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(nightEnvironment(), 0.02).texture;
  scene.environmentIntensity = 1;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.88, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Lane line along the approach and run-out (it stops at the stage), with 1 m ticks.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xbfc3c8 });
  for (const [a, b] of [
    [-70, STAGE.x0 - 0.5],
    [STAGE.x1 + 0.5, 70],
  ]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.15), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set((a + b) / 2, 0.005, 0);
    scene.add(line);
  }
  const tickMat = new THREE.MeshBasicMaterial({ color: 0x4d5158 });
  for (let x = -30; x <= 30; x += 1) {
    if (x > STAGE.x0 - 1 && x < STAGE.x1 + 1) continue;
    const major = x % 5 === 0;
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.04, major ? 0.8 : 0.35), tickMat);
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(x, 0.006, 0.4 + (major ? 0.4 : 0.18));
    scene.add(tick);
  }

  // Stage with LED strips along its front edge and on the ground in front of it.
  const stage = new THREE.Mesh(
    new THREE.BoxGeometry(STAGE.x1 - STAGE.x0, STAGE.height, STAGE.z1 - STAGE.z0),
    new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.3 }),
  );
  stage.position.set((STAGE.x0 + STAGE.x1) / 2, STAGE.height / 2, (STAGE.z0 + STAGE.z1) / 2);
  stage.receiveShadow = true;
  stage.castShadow = true;
  scene.add(stage);
  // LED strips are band-limited glow strips (see glow.ts) so they don't flicker; their
  // long axis is local z, turned to run along x. Local +x then faces −Z, toward the front.
  const ledMat = new THREE.MeshBasicMaterial({ color: RED });
  // 1 cm short of the stage at each end, so its end faces aren't coplanar with the stage sides.
  const edge = strip(ledMat, 0, 0, 0, STAGE.x1 - STAGE.x0 - 0.02, 0.04, 0.05);
  edge.rotation.y = Math.PI / 2;
  edge.position.set((STAGE.x0 + STAGE.x1) / 2, STAGE.height * 0.6, STAGE.z0 - 0.02);
  const groundStrip = strip(ledMat, 0, 0, 0, LED_STRIP.x1 - LED_STRIP.x0, 0.035, 0.06);
  groundStrip.rotation.y = Math.PI / 2;
  groundStrip.position.set((LED_STRIP.x0 + LED_STRIP.x1) / 2, 0.02, LED_STRIP.z);
  scene.add(edge, groundStrip);
  for (const x of [-10, -3.3, 3.3, 10]) {
    const glow = new THREE.PointLight(0xff1a2a, 5, 9, 2);
    glow.position.set(x, 0.35, STAGE.z0 - 0.6);
    scene.add(glow);
  }
  // Red vertical light posts beside the approach, as in the end-on shot.
  for (const [x, z] of [
    [-22, -7],
    [-22, 7],
  ]) {
    const post = strip(ledMat, 0, 0, 0, 3.2, 0.06, 0.06, [-1, 0, 0]);
    post.rotation.x = Math.PI / 2; // long axis (local z) vertical; glow faces the approach (−x)
    post.position.set(x, 1.6, z);
    scene.add(post);
  }

  for (const o of LINEUP) {
    const v = buildParked(o.kind, o.length, o.width, o.height);
    v.position.set(o.x, STAGE.height, LINEUP_Z);
    scene.add(v);
    parked.push({ obstacle: o, group: v });
  }

  scene.add(new THREE.HemisphereLight(0x8494ad, 0x101014, 0.75));

  // Cyan-white floodlights behind the line-up and at the far end of the run-out.
  const floods: [number, number, number][] = [
    [4, 20, 16],
    [-24, 18, 14],
    [30, 16, 3],
  ];
  floods.forEach(([x, y, z], i) => {
    const spot = new THREE.SpotLight(0xd4f3ff, i === 0 ? 520 : 300, 90, Math.PI / 6, 0.6, 1.6);
    spot.position.set(x, y, z);
    spot.target.position.set(x * 0.15, 0, 0);
    if (i === 0) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.camera.near = 5;
      spot.shadow.camera.far = 70;
      spot.shadow.bias = -0.0004;
    }
    scene.add(spot, spot.target);
    addFloodlight(scene, spot.position, spot.target.position);
  });

  const fill = new THREE.DirectionalLight(0x8fa3c0, 0.6);
  fill.position.set(10, 8, -20);
  scene.add(fill);
  return parked;
}

/** Environment-map source: black sky, dark ground, bright flood panels, a red strip near the horizon. */
function nightEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader:
        'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; void main() {
        float up = vDir.y;
        vec3 sky = mix(vec3(0.07, 0.085, 0.1), vec3(0.012, 0.015, 0.02), smoothstep(0.0, 0.6, up));
        vec3 ground = vec3(0.05, 0.05, 0.055);
        gl_FragColor = vec4(up > 0.0 ? sky : ground, 1.0);
      }`,
    }),
  );
  env.add(sky);
  // Large and moderately bright rather than small and intense: tiny HDR panels reflect as
  // pinpoint glints that alias and make the bloom pulse as the camera moves.
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8f4ff).multiplyScalar(2.5) });
  for (const [x, y, z] of [
    [4, 20, 16],
    [-24, 18, 14],
    [30, 16, 3],
  ] as const) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.5), panel);
    p.position.set(x, y, z).normalize().multiplyScalar(40);
    p.lookAt(0, 0, 0);
    env.add(p);
  }
  const red = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 0.6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1428).multiplyScalar(4) }),
  );
  red.position.set(0, 0.5, -38);
  env.add(red);
  return env;
}

/** Pole and lamp head, turned toward the light's target. */
function addFloodlight(scene: THREE.Scene, pos: THREE.Vector3, target: THREE.Vector3) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.8 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, pos.y, 8), poleMat);
  pole.position.set(pos.x, pos.y / 2, pos.z + 0.4);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8fbff).multiplyScalar(4) }),
  );
  lamp.position.copy(pos);
  lamp.lookAt(target);
  scene.add(pole, lamp);
}
