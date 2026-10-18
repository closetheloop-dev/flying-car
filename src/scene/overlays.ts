import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mulMV, norm, type V3 } from '../physics/math';
import type { Sample, Timeline } from '../physics/timeline';
import { formatForce, formatTorque } from '../ui/format';

/** Categorical slots from the validated dark palette (see dataviz palette.md). */
export const FORCE_COLORS = {
  thrust: '#3987e5',
  gravity: '#d95926',
  ground: '#199e70',
  drag: '#c98500',
  torque: '#9085e9',
} as const;

export type ForceKey = keyof typeof FORCE_COLORS;

/** Arrow length per vehicle weight [m]. Drag is drawn 20× larger so it is visible at all. */
const METERS_PER_WEIGHT = 2.5;
const DRAG_EXAGGERATION = 20;
const METERS_PER_KNM = 0.12;

class LabeledArrow {
  readonly arrow: THREE.ArrowHelper;
  readonly label: CSS2DObject;
  private el: HTMLDivElement;

  constructor(
    readonly key: ForceKey,
    private name: string,
  ) {
    this.arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      1,
      FORCE_COLORS[key],
      0.35,
      0.2,
    );
    this.arrow.renderOrder = 10;
    for (const m of [this.arrow.line.material, this.arrow.cone.material] as THREE.Material[]) {
      m.depthTest = false;
      m.transparent = true;
    }
    this.el = document.createElement('div');
    this.el.className = 'arrow-label';
    this.el.innerHTML = `<span class="key" style="background:${FORCE_COLORS[key]}"></span><span class="txt"></span>`;
    this.label = new CSS2DObject(this.el);
  }

  set(origin: THREE.Vector3, vec: V3, lengthM: number, text: string) {
    const visible = lengthM > 0.05;
    this.arrow.visible = visible;
    this.label.visible = visible;
    if (!visible) return;
    const dir = new THREE.Vector3(...vec).normalize();
    this.arrow.position.copy(origin);
    this.arrow.setDirection(dir);
    const head = Math.min(0.45, lengthM * 0.35);
    this.arrow.setLength(lengthM, head, head * 0.55);
    this.label.position.copy(origin).addScaledVector(dir, lengthM + 0.35);
    (this.el.querySelector('.txt') as HTMLSpanElement).textContent = `${this.name} ${text}`;
  }

  setEnabled(on: boolean) {
    if (!on) {
      this.arrow.visible = false;
      this.label.visible = false;
    }
  }
}

export class ForceArrows {
  readonly group = new THREE.Group();
  private arrows: Record<ForceKey, LabeledArrow>;
  enabled = true;
  showLabels = true;

  constructor() {
    this.arrows = {
      thrust: new LabeledArrow('thrust', 'Thrust'),
      gravity: new LabeledArrow('gravity', 'Weight'),
      ground: new LabeledArrow('ground', 'Ground'),
      drag: new LabeledArrow('drag', 'Drag ×20'),
      torque: new LabeledArrow('torque', 'Torque'),
    };
    for (const a of Object.values(this.arrows)) this.group.add(a.arrow, a.label);
  }

  update(s: Sample, cg: THREE.Vector3, weight: number) {
    const all = Object.values(this.arrows);
    if (!this.enabled) {
      all.forEach((a) => a.setEnabled(false));
      return;
    }
    const len = (v: V3, k = 1) => (norm(v) / weight) * METERS_PER_WEIGHT * k;
    this.arrows.thrust.set(cg, s.thrust, len(s.thrust), formatForce(norm(s.thrust)));
    this.arrows.gravity.set(cg, s.gravity, len(s.gravity), formatForce(norm(s.gravity)));
    this.arrows.ground.set(cg, s.ground, len(s.ground), formatForce(norm(s.ground)));
    this.arrows.drag.set(cg, s.drag, len(s.drag, DRAG_EXAGGERATION), formatForce(norm(s.drag)));
    const torqueWorld = mulMV(s.R, s.required.torque);
    const tq = norm(torqueWorld);
    this.arrows.torque.set(cg, torqueWorld, s.airborne ? (tq / 1000) * METERS_PER_KNM : 0, formatTorque(tq));
    all.forEach((a) => (a.label.element.style.display = this.showLabels ? '' : 'none'));
  }
}

/**
 * A see-through copy of the car (sharing its geometry) in one material. The car's invisible
 * shadow box is left out: in the ghost's material it would show as a box around the car.
 */
function ghostClone(source: THREE.Object3D, material: THREE.Material): THREE.Object3D {
  const g = source.clone(true);
  const proxies: THREE.Object3D[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (m.userData.shadowProxy) return void proxies.push(m);
    m.material = material;
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.shared = true; // geometry is the car's
  });
  proxies.forEach((p) => p.removeFromParent());
  return g;
}

/** CG path for the whole maneuver, plus faint ghost poses (the ghost trail) through the flight. */
export class FlightPath {
  readonly group = new THREE.Group();
  private ghosts = new THREE.Group();
  private line: THREE.Line | null = null;
  private ghostMat: THREE.Material | null = null;

  constructor() {
    this.group.add(this.ghosts);
  }

  /**
   * Rebuild for a new timeline. Ghosts are clones of `ghostSource` that share its
   * geometry, so only the line and the ghost material are owned (and freed) here.
   */
  rebuild(tl: Timeline, ghostSource: THREE.Object3D) {
    this.line?.geometry.dispose();
    (this.line?.material as THREE.Material | undefined)?.dispose();
    this.ghostMat?.dispose();
    this.group.clear();
    this.ghosts = new THREE.Group();
    this.group.add(this.ghosts);
    const pts = tl.samples.filter((_, i) => i % 4 === 0).map((s) => new THREE.Vector3(...s.pos));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x86b6ef, transparent: true, opacity: 0.55 }),
    );
    this.line = line;
    this.group.add(line);

    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x86b6ef,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    this.ghostMat = ghostMat;
    const step = 0.2;
    for (let t = 0; t < tl.events.touchdown; t += step) {
      const s = tl.samples[Math.round((t - tl.events.start) / tl.dt)];
      if (!s) continue;
      const g = ghostClone(ghostSource, ghostMat);
      applyPose(g, s);
      this.ghosts.add(g);
    }
  }

  setGhostsVisible(v: boolean) {
    this.ghosts.visible = v;
  }
}

/**
 * Another run, for comparing this one against it (the real stunt, or an explored setting's
 * lower or higher value): its CG path as a line (dashed for the real stunt), and a
 * translucent ghost of the car flying it in step with playback (times are from liftoff in
 * both runs). Clones share the car's geometry, so only the line and the ghost material are
 * owned (and freed) here.
 */
export class RunGhost {
  readonly group = new THREE.Group();
  private line: THREE.Line | null = null;
  private car: THREE.Object3D | null = null;
  private baseline: Timeline | null = null;
  private readonly ghostMat: THREE.MeshStandardMaterial;

  constructor(
    private readonly color = 0xd6dbe2,
    private readonly dashed = true,
  ) {
    this.ghostMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
  }

  /** The run to show (null: none). */
  setBaseline(tl: Timeline | null) {
    if (tl === this.baseline) return;
    this.baseline = tl;
    this.line?.geometry.dispose();
    (this.line?.material as THREE.Material | undefined)?.dispose();
    if (this.line) this.group.remove(this.line);
    this.line = null;
    if (!tl) return;
    const pts = tl.samples.filter((_, i) => i % 4 === 0).map((s) => new THREE.Vector3(...s.pos));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      this.dashed
        ? new THREE.LineDashedMaterial({
            color: this.color,
            dashSize: 0.5,
            gapSize: 0.35,
            transparent: true,
            opacity: 0.5,
          })
        : new THREE.LineBasicMaterial({ color: this.color, transparent: true, opacity: 0.8 }),
    );
    if (this.dashed) line.computeLineDistances();
    this.line = line;
    this.group.add(line);
  }

  /** The car to ghost (built in the body frame, like the stunt car's root): cloned, not moved. */
  setCar(source: THREE.Object3D) {
    if (this.car) this.group.remove(this.car);
    const g = ghostClone(source, this.ghostMat);
    this.car = g;
    this.group.add(g);
  }

  /** Pose the ghost at time t (s from liftoff); hidden outside its run. */
  update(t: number) {
    const tl = this.baseline;
    if (!this.car) return;
    this.car.visible = !!tl && t >= tl.events.start && t <= tl.events.end;
    if (!tl || !this.car.visible) return;
    const i = Math.max(0, Math.min(tl.samples.length - 1, Math.round((t - tl.events.start) / tl.dt)));
    applyPose(this.car, tl.samples[i]);
  }
}

/** Place an object built in the body frame at a sample's position and attitude. */
export function applyPose(obj: THREE.Object3D, s: Sample) {
  obj.position.set(...s.pos);
  const R = s.R;
  const m = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  obj.quaternion.setFromRotationMatrix(m);
}
