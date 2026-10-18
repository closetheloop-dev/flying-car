import { G0 } from '../physics/params';
import { norm } from '../physics/math';
import type { Phase } from '../physics/profile';
import type { Sample, Timeline } from '../physics/timeline';
import { deg, formatForce, formatNum, formatPower, formatTime, formatTorque } from './format';
import { incidentText } from './incidents';
import { axisUnit, fmt, num, toDisplay, unitOf } from './units';

const PHASE_LABEL: Record<Phase, string> = {
  approach: 'Approach',
  launch: 'Launch burn',
  coast: 'Sustained lift thrust',
  landing: 'Landing burn',
  touchdown: 'Touchdown',
  settle: 'Suspension settling',
  slide: 'Burnout slide',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/** Live per-frame readouts and per-thruster force bars. */
export class LivePanel {
  readonly root = el('section', 'panel live');
  private rows = new Map<string, HTMLElement>();
  private bars: { fill: HTMLElement; value: HTMLElement; row: HTMLElement }[] = [];
  private barHost = el('div', 'bars');

  constructor() {
    this.root.setAttribute('aria-label', 'Live readouts');
    // (No heading: the tab above already says Live.)
    const grid = el('dl', 'readouts');
    for (const [key, label] of [
      ['time', 'Time from liftoff'],
      ['phase', 'Phase'],
      ['height', 'CG height'],
      ['drift', 'Off approach line'],
      ['speed', 'Speed'],
      ['roll', 'Roll angle · rate'],
      ['thrust', 'Total thrust'],
      ['tw', 'Thrust ÷ weight'],
      ['torque', 'Required torque'],
      ['gas', 'Gas expelled'],
      ['occ', 'Driver g-load'],
      ['power', 'Jet power'],
    ] as const) {
      const dd = el('dd');
      grid.append(el('dt', undefined, label), dd);
      this.rows.set(key, dd);
    }
    this.root.append(
      grid,
      el('h3', undefined, 'Thruster forces <span class="muted">(bar = share of rated force)</span>'),
      this.barHost,
    );
  }

  setThrusters(tl: Timeline) {
    this.barHost.replaceChildren();
    this.bars = tl.thrusters.map((t) => {
      const row = el('div', 'bar-row');
      row.title = `${t.label}, rated ${formatForce(t.maxForce)}`;
      const fill = el('div', 'bar-fill');
      const track = el('div', 'bar-track');
      track.append(fill);
      const value = el('span', 'bar-value');
      row.append(el('span', 'bar-id', t.id), track, value);
      this.barHost.append(row);
      return { fill, value, row };
    });
  }

  update(s: Sample, tl: Timeline) {
    const weight = tl.params.mass * G0;
    const set = (k: string, v: string) => (this.rows.get(k)!.textContent = v);
    set('time', formatTime(s.t));
    set('phase', PHASE_LABEL[s.phase]);
    set('height', fmt('length', s.pos[1]));
    set('drift', fmt('length', Math.abs(s.pos[2])));
    set('speed', fmt('speed', norm(s.vel)));
    set('roll', `${formatNum(((deg(s.roll) % 360) + 360) % 360, 0)}° · ${formatNum(deg(s.omegaBody[0]), 0)}°/s`);
    set('thrust', formatForce(norm(s.thrust)));
    set('tw', formatNum(norm(s.thrust) / weight, 2));
    set('torque', formatTorque(norm(s.required.torque)));
    set('gas', fmt('mass', s.gasUsed));
    set('occ', `${formatNum(s.occupantG, 2)} g`);
    set('power', formatPower(s.jetPower));
    s.thrusterForces.forEach((f, i) => {
      const b = this.bars[i];
      if (!b) return;
      const frac = f / tl.thrusters[i].maxForce;
      b.fill.style.width = `${Math.min(frac, 1) * 100}%`;
      const over = s.saturated.includes(i);
      b.row.classList.toggle('over', over);
      b.value.textContent = over ? `⚠ ${formatForce(f)}` : formatForce(f);
    });
  }
}

/** Whole-maneuver results: stat tiles, warnings, assumptions and an accessible data table. */
export class SummaryPanel {
  readonly root = el('section', 'panel summary');

  constructor() {
    this.root.setAttribute('aria-label', 'Results for the whole maneuver');
  }

  update(tl: Timeline) {
    const s = tl.summary;
    const p = tl.params;
    const landed = tl.samples.find((x) => x.t >= tl.events.touchdown) ?? tl.samples[tl.samples.length - 1];
    const c = tl.control;
    const controlTiles: [string, string, string][] = c
      ? [
          [
            'Tracking error',
            fmt('length', c.maxPosError),
            `rms ${fmt('length', c.rmsPosError)} · attitude up to ${formatNum(c.maxAttError, 1)}°`,
          ],
          [
            'Touchdown',
            fmt('velocity', c.touchdownSpeed),
            `at ${formatNum(c.touchdownTime, 2)} s · ${formatNum(c.touchdownTiltDeg, 1)}° from level`,
          ],
          [
            'Landing point',
            fmt('length', Math.hypot(...c.landingError)),
            `off the ideal spot (${fmt('length', c.landingError[0])} along, ${fmt('length', c.landingError[1])} across)`,
          ],
          [
            'Gas vs ideal flight',
            `${c.extraGas < 0 ? '−' : c.extraGas > 0 ? '+' : ''}${fmt('mass', Math.abs(c.extraGas))}`,
            `${c.extraGas < 0 ? 'less' : c.extraGas > 0 ? 'more' : 'the same'} nitrogen · ${c.pulses} valve pulses · both side thrusters ${formatNum(c.opposedSideTime, 2)} s`,
          ],
        ]
      : [];
    const tiles: [string, string, string][] = [
      ...controlTiles,
      ['Peak thrust', formatForce(s.peakThrust.value), `${formatNum(s.peakThrustToWeight, 2)} × weight (launch burn)`],
      ['Landing burn', formatForce(s.landingThrust), `${formatNum(s.landingThrust / s.weight, 2)} × weight`],
      [
        'Peak roll torque',
        formatTorque(s.peakRollTorque.value),
        `roll rate up to ${formatNum(deg(s.peakRollRate.value), 0)}°/s`,
      ],
      ['Busiest nozzle', formatForce(s.peakThruster.value), `${tl.thrusters[s.peakThruster.index]?.label ?? '—'}`],
      [
        'Sideways drift',
        fmt('length', Math.abs(landed.pos[2])),
        `from the lift jets turning with the roll (${formatNum(p.sustainThrustG, 2)} g sustained)`,
      ],
      ['Total impulse', fmt('impulse', s.totalImpulse), `exhaust velocity ${fmt('velocity', s.exhaustVelocity, 0)}`],
      ['Nitrogen used', fmt('mass', s.gasMass), `${formatNum((s.gasMass / p.mass) * 100, 1)}% of vehicle mass`],
      [
        'Tank volume',
        fmt('volume', s.tankVolumeLiters / 1000),
        `at ${fmt('pressure', p.tankPressure)} · COPVs ≈ ${fmt('mass', s.tankMass, 0)}`,
      ],
      ['Peak jet power', formatPower(s.peakJetPower.value), 'kinetic power in the exhaust'],
      [
        'Driver peak g',
        `${formatNum(s.peakOccupantG.value, 2)} g`,
        `near-weightless ${formatNum(s.weightlessTime, 2)} s`,
      ],
      ['Clearance', fmt('length', s.minClearance.value), `lowest gap, over the ${s.minClearance.obstacle}`],
      [
        'Touchdown load',
        formatForce(s.touchdownLoad),
        `${formatNum(s.touchdownLoad / s.weight, 1)} × weight on the tires`,
      ],
      [
        'Without landing burn',
        formatForce(s.noBurnImpactLoad),
        `${fmt('speed', s.noBurnImpactSpeed)} impact · ${formatNum(s.noBurnImpactLoad / s.weight, 0)} × weight`,
      ],
    ];
    // Incidents are listed in the display units; other warnings as they are.
    const byMessage = new Map(tl.incidents.map((i) => [i.message, incidentText(i)]));
    const problems = [
      ...tl.warnings.map((w) => byMessage.get(w) ?? w),
      ...tl.incidents.filter((i) => !tl.warnings.includes(i.message)).map(incidentText),
    ];
    const warn = problems.length
      ? `<ul class="warnings">${problems.map((w) => `<li><span class="status-icon" aria-hidden="true">⚠</span><span class="status-label">Problem</span> ${w}</li>`).join('')}</ul>`
      : `<p class="ok"><span class="status-icon" aria-hidden="true">✓</span> Maneuver feasible with these assumptions.</p>`;
    this.root.innerHTML = `
      <h2>Forces required <span class="muted">(whole maneuver, ${c ? 'closed-loop flight' : 'ideal flight'})</span></h2>
      ${warn}
      <div class="tiles">${tiles.map(([l, v, d]) => `<div class="tile"><div class="tile-label">${l}</div><div class="tile-value">${v}</div><div class="tile-delta">${d}</div></div>`).join('')}</div>
      <p class="muted small">Approach speed to cover ${fmt('length', p.range, 0)} in ${formatNum(tl.flight.T, 2)} s:
        ${fmt('speed', s.approachSpeed)}. ${
          c
            ? 'In closed-loop flight the controller tracks the ideal flight; forces are what the thrusters actually delivered.'
            : `Thrusters match the required force and torque to within ${s.maxResidual < 1e-5 ? '0.001' : formatNum(s.maxResidual * 100, 3)} %.`
        }</p>
      <details><summary>Data table (every 0.1 s)</summary>${this.table(tl)}</details>
      <details><summary>How the forces are derived</summary>
        <ol class="small">
          <li>The barrel roll is fitted to the car's attitude in the footage. The lift jets fire along the
            car's up axis for the whole hop, as the footage shows: a launch burn (sized to reach the apex),
            a sustained thrust, and a landing burn (solved for a soft touchdown). Because that thrust turns
            with the roll, it also pushes the car sideways (the drift) and down while inverted. The
            flight path is integrated from it.</li>
          <li>Newton: required thrust <b>F = m·a − m·g − D</b> (D = drag), resolved into the rotating body frame.</li>
          <li>Euler: required torque <b>τ = I·α + ω × (I·ω)</b> about the CG.</li>
          <li>Thruster allocation: non-negative least squares spreads the 6-axis wrench across the six
            thrusters (they can only push). The car rolls by firing its left and right lift thrusters
            unevenly, so the lift is raised wherever the roll needs more torque than it allows.</li>
          <li>Gas: ṁ = F / (Isp·g₀) per nozzle; tank volume from the N₂ density at storage pressure.</li>
        </ol>
      </details>`;
  }

  private table(tl: Timeline): string {
    const rows: string[] = [];
    const every = Math.round(0.1 / tl.dt);
    const force = axisUnit('force', tl.summary.peakThrust.value);
    const torque = axisUnit('torque', tl.summary.peakRollTorque.value);
    const fd = unitOf('force') === 'lbf' ? 0 : 1;
    tl.samples.forEach((s, i) => {
      if (i % every !== 0 || s.t < -0.5 || s.t > tl.events.touchdown + 1) return;
      rows.push(
        `<tr><td>${s.t.toFixed(2)}</td><td>${PHASE_LABEL[s.phase]}</td>` +
          `<td>${num(toDisplay('length', s.pos[1]), 2)}</td><td>${num(toDisplay('length', s.pos[2]), 2)}</td>` +
          `<td>${num(norm(s.thrust) * force.factor, fd)}</td><td>${num(norm(s.required.torque) * torque.factor, fd)}</td>` +
          `<td>${num(toDisplay('mass', s.gasUsed), 1)}</td><td>${s.occupantG.toFixed(2)}</td></tr>`,
      );
    });
    return `<div class="table-wrap"><table><thead><tr><th>t (s)</th><th>Phase</th>
      <th>CG height (${unitOf('length')})</th><th>Sideways (${unitOf('length')})</th>
      <th>Thrust (${force.unit})</th><th>Torque (${torque.unit})</th><th>Gas (${unitOf('mass')})</th><th>Driver g</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }
}
