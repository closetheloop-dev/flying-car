/**
 * The body of the Guide, /guide/ (rendered at build time from the same data as the Lab): the flight
 * models, then every setting by group, each with what it does, its range, the stunt's
 * value and a labeled drawing.
 */
import { DEFAULT_PARAMS } from '../physics/params';
import { FOLDER_DOCS, MODE_DOCS, SETTING_DOCS } from '../physics/setting-docs';
import { FLIGHT_MODES, FOLDER_NAMES, SETTINGS, type Setting, type SettingQuantity } from '../physics/settings';
import { DIAGRAM_DEFS, diagram } from './setting-diagrams';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A value in metric and in US units, e.g. "8.5 m (27.9 ft)". */
const UNITS: Record<SettingQuantity, { si: [string, number, number]; us: [string, number, number] }> = {
  length: { si: ['m', 1, 1], us: ['ft', 3.28084, 1] },
  shortLength: { si: ['cm', 100, 1], us: ['in', 39.3701, 1] },
  mass: { si: ['kg', 1, 0], us: ['lb', 2.20462, 0] },
  force: { si: ['kN', 1e-3, 1], us: ['lbf', 0.224809, 0] },
  pressure: { si: ['bar', 1e-5, 0], us: ['psi', 1.45038e-4, 0] },
  velocity: { si: ['m/s', 1, 1], us: ['ft/s', 3.28084, 1] },
  accel: { si: ['m/s²', 1, 1], us: ['ft/s²', 3.28084, 1] },
  area: { si: ['m²', 1, 1], us: ['ft²', 10.7639, 0] },
};
/** (With a true minus sign, as the app shows numbers.) */
const number = (v: number, digits: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    .format(v)
    .replace(/^-/, '−');
function value(s: Setting, si: number): string {
  // Barrel rolls as the Tweak card shows them too: ↺ toward the parked cars, ↻ away.
  if (s.key === 'rollTurns')
    return si === 0 ? '0 (no roll)' : `${number(si, 0)} (${Math.abs(si)} ${si < 0 ? '↺' : '↻'})`;
  if (!s.quantity) return `${number(si, 3)}${s.displayUnit ? ` ${s.displayUnit}` : ''}`;
  const { si: m, us } = UNITS[s.quantity];
  return `${number(si * m[1], m[2])} ${m[0]} (${number(si * us[1], us[2])} ${us[0]})`;
}

function settingCard(s: Setting): string {
  const doc = SETTING_DOCS[s.key]!;
  const name = s.label.replace(/\s*\((s|°|g|Hz|rad\/s|fraction)\)$/, '');
  return (
    `<article class="setting" id="${s.key}">` +
    `<div class="setting-text">` +
    `<h3><a href="#${s.key}">${esc(name)}</a> <code>${s.key}</code></h3>` +
    `<p class="hint">${esc(doc.hint)}</p>` +
    `<p>${esc(doc.detail)}</p>` +
    `<dl><dt>The stunt</dt><dd>${esc(value(s, DEFAULT_PARAMS[s.key] as number))}</dd>` +
    // ("Allowed", not "Range": one of the settings is called Range.)
    `<dt>Allowed</dt><dd>${esc(value(s, s.min))} to ${esc(value(s, s.max))}</dd></dl>` +
    `<p class="fly"><a href="/?explore=${s.key}">See it fly lower and higher →</a></p>` +
    `</div>` +
    diagram(doc.diagram, doc.mark, name) +
    `</article>`
  );
}

export function renderSettingsReference(): string {
  const groups = FOLDER_NAMES.map((folder) => ({
    folder,
    id: slug(folder),
    settings: SETTINGS.filter((s) => s.folder === folder),
  }));
  const toc =
    `<nav class="toc" aria-label="On this page"><div class="toc-links"><a href="#flight-models">Flight models</a>` +
    groups.map((g) => `<a href="#${g.id}">${esc(g.folder.replace(/\s*\(.*\)$/, ''))}</a>`).join('') +
    `</div></nav>`;
  const modes =
    `<section id="flight-models"><h2>Flight models</h2><div class="modes">` +
    FLIGHT_MODES.map(
      (m) => `<div class="mode"><h3>${esc(MODE_DOCS[m].name)}</h3><p>${esc(MODE_DOCS[m].text)}</p></div>`,
    ).join('') +
    `</div></section>`;
  const sections = groups
    .map(
      (g) =>
        `<section id="${g.id}"><h2>${esc(g.folder)}</h2><p class="group-note">${esc(FOLDER_DOCS[g.folder] ?? '')}</p>` +
        g.settings.map(settingCard).join('') +
        `</section>`,
    )
    .join('');
  return DIAGRAM_DEFS + toc + modes + sections;
}
