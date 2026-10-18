import { norm } from '../physics/math';
import { G0 } from '../physics/params';
import type { Phase } from '../physics/profile';
import type { Sample, Timeline } from '../physics/timeline';
import { num, toDisplay, unitOf } from './units';

const PHASE: Record<Phase, string> = {
  approach: 'Approach',
  launch: 'Launch burn',
  coast: 'Flying',
  landing: 'Landing burn',
  touchdown: 'Touchdown',
  settle: 'Touchdown',
  slide: 'Sliding to a stop',
};

const NS = 'http://www.w3.org/2000/svg';

/**
 * The game-style instruments over the 3D view: altitude, speed, driver g, thrust as a
 * multiple of weight, a roll dial and the phase. Values in the current display units.
 */
export class FlightHud {
  private phase = document.createElement('div');
  private gauges: Record<'alt' | 'spd' | 'g' | 'thr', { root: HTMLElement; value: HTMLElement; unit: HTMLElement }>;
  private car: SVGGElement;
  private rollText: SVGTextElement;
  private shownPhase: Phase | null = null;

  constructor(host: HTMLElement) {
    this.phase.className = 'hud-phase';
    host.append(this.phase);
    const gauge = (label: string) => {
      const root = document.createElement('div');
      root.className = 'gauge';
      root.innerHTML = `<div class="gauge-label">${label}</div><div><span class="gauge-value"></span><span class="gauge-unit"></span></div>`;
      host.append(root);
      return {
        root,
        value: root.querySelector<HTMLElement>('.gauge-value')!,
        unit: root.querySelector<HTMLElement>('.gauge-unit')!,
      };
    };
    this.gauges = { alt: gauge('ALT'), spd: gauge('SPEED'), g: gauge('G-LOAD'), thr: gauge('THRUST') };

    // Roll dial: the car seen from behind, turning with the roll; the cyan dot is its roof.
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'roll-dial');
    svg.setAttribute('viewBox', '-32 -32 64 64');
    svg.innerHTML = `<circle class="ring" r="30"/><line class="horizon" x1="-27" y1="0" x2="27" y2="0"/>
      <g class="rot"><rect class="car" x="-15" y="-5" width="30" height="10" rx="4"/><circle class="up" cx="0" cy="-10" r="3"/></g>
      <text y="25" text-anchor="middle">0°</text>`;
    this.car = svg.querySelector('.rot')!;
    this.rollText = svg.querySelector('text')!;
    host.append(svg);
  }

  update(s: Sample, tl: Timeline) {
    const air = s.airborne;
    if (s.phase !== this.shownPhase) {
      this.shownPhase = s.phase;
      this.phase.textContent = PHASE[s.phase];
      this.phase.className = `hud-phase${s.phase === 'launch' || s.phase === 'landing' ? ' burn' : air ? '' : ' ground'}`;
    }
    // Height of the car's underside above the ground, the way a pilot reads altitude.
    const alt = Math.max(s.pos[1] - tl.params.cgHeight, 0);
    this.set('alt', toDisplay('length', alt), unitOf('length'), 1);
    this.set('spd', toDisplay('speed', norm(s.vel)), unitOf('speed'), 0);
    this.set('g', s.occupantG, 'g', 1);
    const tw = norm(s.thrust) / (s.mass * G0);
    this.set('thr', tw, '× wt', 1);
    this.gauges.g.root.classList.toggle('hot', s.occupantG >= 3 && s.occupantG < 6);
    this.gauges.g.root.classList.toggle('danger', s.occupantG >= 6);
    this.gauges.thr.root.classList.toggle('hot', tw >= 1.5);
    const rollDeg = (s.roll * 180) / Math.PI;
    this.car.setAttribute('transform', `rotate(${rollDeg.toFixed(1)})`);
    const shown = ((Math.round(-rollDeg) % 360) + 360) % 360;
    this.rollText.textContent = `${shown}°`;
  }

  private set(k: keyof FlightHud['gauges'], v: number, unit: string, digits: number) {
    this.gauges[k].value.textContent = num(v, digits);
    this.gauges[k].unit.textContent = unit;
  }
}
