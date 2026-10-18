/**
 * The About text and the site's outside links: plain strings, no browser APIs, so the pages
 * plugin can render /about/ from it at build time (the simulation's dialog: about.ts).
 */
import { contactImage } from './contact';

/** The source video the simulation recreates. */
export const FOOTAGE_URL = 'https://x.com/Tesla/status/2110926164306931860';
/** The source code (also linked from the top bar and the pages' HTML). */
export const REPO_URL = 'https://github.com/closetheloop-dev/flying-car';
/** The blog posts on how this was made (also linked from the top bar, the pages' footer and
 * the README). */
export const BLOG_URL = 'https://closetheloop.dev/blog/flying-car';

const MODELS: [string, string, string, string][] = [
  [
    'Tesla Roadster 2020',
    'https://sketchfab.com/3d-models/tesla-roadster-2020-1fbf29e297bd4a17ac39a00a378441d8',
    'metarex.4d',
    'CC BY 4.0',
  ],
  [
    'Tesla Model 3 2024',
    'https://sketchfab.com/3d-models/tesla-model-3-2024-36c52f3f89f6439c90310f14e8ff33f2',
    'brandonleong28',
    'CC BY 4.0',
  ],
  [
    '2025 Tesla Model Y',
    'https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74',
    'BloxBloger',
    'CC BY-NC 4.0',
  ],
  [
    'Tesla Cybertruck',
    'https://sketchfab.com/3d-models/tesla-cybertruck-3e72defa993c4d81b9deb2eee1ee6054',
    'neshallads',
    'CC BY 4.0',
  ],
  [
    'Tesla Semi',
    'https://sketchfab.com/3d-models/tesla-semi-39ffc7c746184e0c9ebd5bbcd0b405dd',
    'Aleksei Rozumnyi',
    'CC BY 4.0',
  ],
];

/** The two models the scene's Cybercab was generated from. */
const CYBERCAB_SOURCES: [string, string, string, string][] = [
  ['cybercab', 'https://sketchfab.com/3d-models/cybercab-81296685568f43b9a773cb4ebdd42c02', 'onurd', 'CC BY 4.0'],
  [
    'Tesla Cybercab 3D Model',
    'https://sketchfab.com/3d-models/tesla-cybercab-3d-model-45c25fd8442b45129e47be2e66449ca3',
    'Grass Grass Grass',
    'CC BY 4.0',
  ],
];

const LICENSES: Record<string, string> = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-NC 4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
};

const credit = ([name, url, author, lic]: [string, string, string, string]) =>
  `<a href="${url}" target="_blank" rel="noopener">“${name}”</a> by ${author} (<a href="${LICENSES[lic]}" target="_blank" rel="noopener">${lic}</a>)`;

/**
 * What this is, how to play, how it works, the credits and the contact: the simulation's
 * About dialog and the /about/ page (rendered at build time) both show this, so they match.
 * `level` is its sections' heading level: 3 under the dialog's h2, 2 under the page's h1.
 */
export function aboutHtml(level: 2 | 3 = 3): string {
  return aboutSections().replace(/<(\/?)h3>/g, `<$1h${level}>`);
}

function aboutSections(): string {
  return `<p>A Roadster lifts off on cold-gas thrusters, barrel-rolls over a line of five parked cars
    (a Semi in the middle) and lands. This is that hop rebuilt as a physics simulation from
    the <a href="${FOOTAGE_URL}" target="_blank" rel="noopener">original video</a>: every force
    the thrusters need, second by second.</p>

    <h3>Play</h3>
    <ul>
      <li><b>Launch</b> runs the hop; <b>Tweak it</b> changes the car's mass, the hop's height and
      range, and the roll, then launch again and see whether it still lands.</li>
      <li>When your settings differ from the real stunt, the faint <b>Real-stunt car</b> flies it
      alongside, so you can compare; <b>Ghost trail</b> leaves snapshots of your car along its path.</li>
      <li>Drag to orbit; scroll or pinch to zoom. Pick a camera at the bottom: <b>Footage cam</b>
      stands where the video's front camera stood, and <b>Real footage</b> shows the video beside it.</li>
      <li>The <b>Lab</b> has every number: live forces, the whole-hop results, and all the
      parameters (the <a href="/guide/">Guide</a> explains each one). Every setting is in the URL,
      so <b>Share</b> sends this exact flight.</li>
      <li class="keys">On a keyboard: <kbd>Space</kbd> play/pause, <kbd>←</kbd> <kbd>→</kbd> step,
      <kbd>Home</kbd> start, <kbd>R</kbd> replay, <kbd>C</kbd> camera, <kbd>F</kbd> footage,
      <kbd>L</kbd> Lab, <kbd>Esc</kbd> close.</li>
    </ul>

    <h3>How it works</h3>
    <p>The hop's timing, height, range and roll are measured from the video's four camera
    angles. The flight is then solved for the thrust it needs: a launch burn, a steady lift
    that turns with the roll, and a landing burn for a soft touchdown. By default a simulated
    flight controller flies it through gusts and thruster errors, so the forces are the ones it
    actually delivers. The nitrogen, tank, roll torque and g-loads follow from those.</p>

    <h3>How it was made</h3>
    <p>The making of this site, step by step, is written up on the
    <a href="${BLOG_URL}" target="_blank" rel="noopener">closetheloop.dev blog</a>.</p>

    <h3>Use it with an AI agent</h3>
    <p>The page offers its controls as <b>WebMCP</b> tools, so an AI agent in your browser can
    run simulations for you: try a heavier car, find the highest hop that still lands, or jump to
    the moment the car clears the Semi. The tools run here in your browser.
    <a href="/webmcp/">How to use them, with examples</a>.</p>

    <h3>Credits</h3>
    <p>Footage: <a href="${FOOTAGE_URL}" target="_blank" rel="noopener">@Tesla on X</a>, shown here
    in small frames, synced to the simulation, for comparison and commentary.</p>
    <p>Vehicle models: modified versions of these Sketchfab models, not the originals. Each was
    simplified and edited for this site, and is changed again as the scene loads (windows tinted,
    interiors removed, meshes simplified, the Roadster repainted). The modified models are
    shared under the same license as each original.</p>
    <ul>${MODELS.map((m) => `<li>${credit(m)}</li>`).join('')}
      <li>Cybercab: generated from ${CYBERCAB_SOURCES.map(credit).join(' and ')}.</li>
    </ul>
    <p>Built with three.js. Fonts: Inter and Rajdhani (SIL Open Font License).
    <a href="/licenses.md" target="_blank" rel="noopener">Licenses of the bundled libraries</a>.</p>
    <p>Source code: <a href="${REPO_URL}" target="_blank" rel="noopener">on GitHub</a> (MIT License).</p>

    <h3>Not affiliated with Tesla</h3>
    <p>flyingcar.pet is an independent fan project. Tesla, Roadster, Model 3, Model Y, Cybertruck,
    Cybercab and Semi are Tesla's trademarks, used here only to name the vehicles.</p>

    <h3>Contact</h3>
    <p>${contactImage()}</p>
    <p><a href="/privacy/">Privacy</a></p>`;
}
