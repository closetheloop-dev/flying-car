import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { STAGE } from '../physics/layout';
import { bodyBox, type Incident, type Timeline } from '../physics/timeline';
import { formatTime } from '../ui/format';
import { incidentLabel } from '../ui/incidents';

const ALERT_RED = 0xff3b3b;
/** Seconds after an incident's end during which its marker keeps pulsing. */
const PULSE_TAIL = 0.4;
/** Label height above the spot, and the vertical spacing of stacked labels [m]. */
const LABEL_RISE = 1.9;
const LABEL_STACK = 0.8;

/** Red line box from corner a to corner b (world axis-aligned). */
function boxLines(a: THREE.Vector3, b: THREE.Vector3, mat: THREE.LineBasicMaterial): THREE.LineSegments {
  const size = new THREE.Vector3().subVectors(b, a);
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
  const lines = new THREE.LineSegments(edges, mat);
  lines.position.copy(a).addScaledVector(size, 0.5);
  return lines;
}

/** Draw on top of everything, so an alert is never hidden behind the car or a vehicle. */
function overlay<T extends THREE.Material>(m: T): T {
  m.depthTest = false;
  m.transparent = true;
  return m;
}

/** A red ring, drawn once; used on camera-facing sprites so it reads from any view. */
let ringTexture: THREE.CanvasTexture | null = null;
function ring(): THREE.CanvasTexture {
  if (ringTexture) return ringTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ff3b3b';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ff3b3b';
  g.beginPath();
  g.arc(64, 64, 12, 0, Math.PI * 2);
  g.fill();
  ringTexture = new THREE.CanvasTexture(c);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
}

interface Marker {
  incident: Incident;
  root: THREE.Group;
  sprite: THREE.Sprite;
  spriteMat: THREE.SpriteMaterial;
  label: CSS2DObject;
  labelEl: HTMLElement;
  /** Measured on first use (0 until then, or while the label is hidden). */
  labelWidth: number;
  outline?: THREE.LineSegments;
  edge: HTMLButtonElement;
}

/** The part of the window where the 3D view is not covered by panels [client px]. */
export interface FreeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where each incident happens, shown in the 3D view as playback reaches it: a red ring
 * and label at the spot, the solid that was hit outlined in red, and the car outlined in
 * red while it is inside something. Before an incident's time nothing shows; while it is
 * happening the marker pulses; afterwards it stays, dimmer, until playback loops. If the
 * spot is off-screen or behind a panel, a red chip at the edge of the free view points
 * toward it; clicking the chip frames it.
 */
export class IncidentMarkers {
  readonly group = new THREE.Group();
  private markers: Marker[] = [];
  private carOutline: THREE.LineSegments | null = null;
  private owned: { dispose(): void }[] = [];
  private readonly v = new THREE.Vector3();

  constructor(
    private edgeHost: HTMLElement,
    private onFrame: (incident: Incident) => void,
  ) {}

  rebuild(tl: Timeline, carRoot: THREE.Object3D) {
    this.dispose();
    // Labels of incidents close together are stacked (by their height in the world), so
    // they don't cover each other.
    const heights: { x: number; z: number; y: number }[] = [];
    for (const incident of tl.incidents) {
      const [x, y0, z] = incident.point;
      let y = y0 + LABEL_RISE;
      const near = heights.filter((h) => Math.hypot(h.x - x, h.z - z) < 6);
      while (near.some((h) => Math.abs(h.y - y) < LABEL_STACK * 0.95)) y += LABEL_STACK;
      heights.push({ x, z, y });
      this.markers.push(this.buildMarker(incident, y - y0));
    }
    // The collision body box, in the car's body frame (it rides along with the car).
    const { hx, hy, hz, yOff } = bodyBox(tl.params);
    const mat = overlay(new THREE.LineBasicMaterial({ color: ALERT_RED }));
    this.owned.push(mat);
    this.carOutline = boxLines(new THREE.Vector3(-hx, yOff - hy, -hz), new THREE.Vector3(hx, yOff + hy, hz), mat);
    this.owned.push(this.carOutline.geometry);
    this.carOutline.renderOrder = 20;
    this.carOutline.visible = false;
    carRoot.add(this.carOutline);
  }

  /** Refresh label text (e.g. after the unit system changes). */
  relabel() {
    for (const m of this.markers) {
      this.fillLabel(m.labelEl, m.edge, m.incident);
      m.labelWidth = 0; // re-measure
    }
  }

  private fillLabel(el: HTMLElement, edge: HTMLButtonElement, i: Incident) {
    el.innerHTML = `<span class="incident-icon" aria-hidden="true">⚠</span><span>${incidentLabel(i)}</span><span class="incident-time">${formatTime(i.t)}</span>`;
    edge.innerHTML = `<span class="arrow" aria-hidden="true">➤</span><span>${incidentLabel(i)}</span>`;
    edge.title = `Show where it happens (${formatTime(i.t)})`;
  }

  private buildMarker(incident: Incident, labelY: number): Marker {
    const root = new THREE.Group();
    root.position.set(...incident.point);
    const spriteMat = overlay(new THREE.SpriteMaterial({ map: ring(), color: 0xffffff }));
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.3, 1.3, 1);
    sprite.renderOrder = 21;
    // A stem from the spot up to the label, so the label never covers the spot.
    const stemMat = overlay(new THREE.LineBasicMaterial({ color: ALERT_RED }));
    const stemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, labelY, 0)]);
    const stem = new THREE.Line(stemGeo, stemMat);
    stem.renderOrder = 21;
    const anchor = document.createElement('div');
    anchor.className = 'incident-anchor';
    const labelEl = document.createElement('div');
    labelEl.className = 'incident-label';
    anchor.append(labelEl);
    const label = new CSS2DObject(anchor);
    label.position.set(0, labelY, 0);
    root.add(sprite, stem, label);
    this.owned.push(spriteMat, stemMat, stemGeo);

    const edge = document.createElement('button');
    edge.type = 'button';
    edge.className = 'incident-edge';
    edge.hidden = true;
    edge.onclick = () => this.onFrame(incident);
    this.edgeHost.append(edge);
    this.fillLabel(labelEl, edge, incident);

    let outline: THREE.LineSegments | undefined;
    const s = incident.solid;
    if (s && Number.isFinite(s.x0)) {
      const bottom = s.label === 'stage' ? 0 : STAGE.height; // vehicles stand on the stage
      const mat = overlay(new THREE.LineBasicMaterial({ color: ALERT_RED }));
      outline = boxLines(new THREE.Vector3(s.x0, bottom, s.z0), new THREE.Vector3(s.x1, s.top, s.z1), mat);
      outline.renderOrder = 20;
      this.owned.push(mat, outline.geometry);
      this.group.add(outline);
    }
    this.group.add(root);
    return { incident, root, sprite, spriteMat, label, labelEl, labelWidth: 0, outline, edge };
  }

  /** Show what has happened by time t; pulse what is happening now; point at what is out of view. */
  update(t: number, wallClock: number, camera: THREE.Camera, canvas: DOMRect, free: FreeRect, blockers: DOMRect[]) {
    let inside = false;
    const pulse = 0.5 + 0.5 * Math.sin(wallClock * 10);
    this.chips = [];
    for (const m of this.markers) {
      const { incident: i } = m;
      const shown = t >= i.t - 1e-6;
      const active = shown && t <= i.tEnd + PULSE_TAIL;
      if (i.kind === 'collision' && shown && t <= i.tEnd + 1e-6) inside = true;
      m.root.visible = shown;
      m.label.visible = shown;
      m.labelEl.classList.toggle('active', active);
      if (m.outline) {
        m.outline.visible = shown;
        (m.outline.material as THREE.LineBasicMaterial).opacity = active ? 0.6 + 0.4 * pulse : 0.55;
      }
      const s = active ? 1.3 * (1 + 0.35 * pulse) : 1.3;
      m.sprite.scale.set(s, s, 1);
      m.spriteMat.opacity = active ? 0.7 + 0.3 * pulse : 0.65;
      this.placeEdge(m, shown, camera, canvas, free, blockers);
    }
    if (this.carOutline) {
      this.carOutline.visible = inside;
      (this.carOutline.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.4 * pulse;
    }
  }

  /** Edge chips placed so far this frame, so later ones can be moved clear of them. */
  private chips: { x: number; y: number }[] = [];

  /** Where a world point lands on the page, mirrored if it is behind the camera. */
  private toPage(world: THREE.Vector3, camera: THREE.Camera, canvas: DOMRect) {
    const ndc = this.v.copy(world).project(camera);
    const behind = ndc.z > 1;
    let x = canvas.left + ((ndc.x + 1) / 2) * canvas.width;
    let y = canvas.top + ((1 - ndc.y) / 2) * canvas.height;
    if (behind) {
      x = 2 * (canvas.left + canvas.width / 2) - x;
      y = 2 * (canvas.top + canvas.height / 2) - y;
    }
    return { x, y, behind };
  }

  /**
   * If neither the spot nor its label is in the free view (off-screen, behind the camera
   * or under a panel), put a chip at the edge pointing to it. A label that would run under
   * a panel on the right (the Tweak card, the Lab) is flipped to the left of its stem.
   */
  private placeEdge(
    m: Marker,
    shown: boolean,
    camera: THREE.Camera,
    canvas: DOMRect,
    free: FreeRect,
    blockers: DOMRect[],
  ) {
    if (!shown) {
      m.edge.hidden = true;
      return;
    }
    const visible = (q: { x: number; y: number; behind: boolean }) =>
      !q.behind &&
      q.x >= free.left &&
      q.x <= free.right &&
      q.y >= free.top &&
      q.y <= free.bottom &&
      !blockers.some((b) => q.x >= b.left && q.x <= b.right && q.y >= b.top && q.y <= b.bottom);
    const spot = this.toPage(new THREE.Vector3(...m.incident.point).setY(m.incident.point[1] + 0.3), camera, canvas);
    const anchor = this.toPage(m.root.localToWorld(m.label.position.clone()), camera, canvas);
    // The label's width, measured once (reading it every frame would force a layout).
    m.labelWidth ||= m.labelEl.offsetWidth;
    const w = m.labelWidth;
    // Flip to the left of the stem if it would run under the panel and fits on that side.
    const flip = anchor.x + 14 + w > free.right && anchor.x - 14 - w >= free.left;
    m.labelEl.classList.toggle('flip', flip);
    const labelCenter = { x: anchor.x + (flip ? -1 : 1) * (14 + w / 2), y: anchor.y - 16, behind: anchor.behind };
    const inView = visible(spot) || visible(labelCenter);
    m.edge.hidden = inView;
    if (inView) return;
    // Clamp toward the free view's center along the line to the spot, then step clear of
    // chips already placed this frame.
    const pad = 70;
    const cx = (free.left + free.right) / 2,
      cy = (free.top + free.bottom) / 2;
    const dx = spot.x - cx,
      dy = spot.y - cy;
    const sx = (free.right - free.left) / 2 - pad,
      sy = (free.bottom - free.top) / 2 - 18;
    const k = Math.min(dx ? Math.abs(sx / dx) : Infinity, dy ? Math.abs(sy / dy) : Infinity, 1);
    let x = cx + dx * k;
    let y = cy + dy * k;
    // A chip that would sit on a panel (the footage window) goes beside that panel's left
    // edge instead, at the same height.
    const under = blockers.find(
      (b) => x + pad >= b.left && x - pad <= b.right && y + 14 >= b.top && y - 14 <= b.bottom,
    );
    if (under) {
      x = under.left - pad - 6;
      y = Math.min(Math.max(y, free.top + 18), free.bottom - 18);
    }
    while (this.chips.some((c) => Math.abs(c.x - x) < 160 && Math.abs(c.y - y) < 26)) y += y > cy ? -26 : 26;
    this.chips.push({ x, y });
    m.edge.style.left = `${x}px`;
    m.edge.style.top = `${y}px`;
    (m.edge.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }

  /** The incident whose start was crossed going from time a to b (for a one-off flash). */
  crossed(a: number, b: number): Incident | undefined {
    return this.markers.find((m) => a < m.incident.t && b >= m.incident.t)?.incident;
  }

  dispose() {
    for (const m of this.markers) {
      m.label.element.remove();
      m.edge.remove();
    }
    this.markers = [];
    this.group.clear();
    this.carOutline?.removeFromParent();
    this.carOutline = null;
    this.owned.forEach((o) => o.dispose());
    this.owned = [];
  }
}
