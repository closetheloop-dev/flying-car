# Flying Car (flyingcar.pet)

A three.js reconstruction of
[the original video, @Tesla on X](https://x.com/Tesla/status/2110926164306931860). In the
video a Tesla Roadster lifts off flat ground on cold-gas thrusters and does a full barrel roll
over a line-up of five parked Tesla vehicles (Model 3, Model Y, Semi, Cybertruck and Cybercab)
on a low stage. It drifts sideways while it does this, lands off the line it came in on with a
braking burn, and goes into a burnout. The app replays the stunt and works out the thrust,
torque, gas and loads needed to do it. It is published at **[flyingcar.pet](https://flyingcar.pet/)**
as an independent fan project, not affiliated with Tesla. The **Guide**,
[flyingcar.pet/guide/](https://flyingcar.pet/guide/), explains what each setting does,
with a drawing each (built from `src/physics/setting-docs.ts`). An AI agent can drive it through its
WebMCP tools: see [docs/webmcp.md](docs/webmcp.md) (also at
[flyingcar.pet/webmcp/](https://flyingcar.pet/webmcp/)). How it was made is written up on
the [closetheloop.dev blog](https://closetheloop.dev/blog/flying-car).

```sh
pnpm install
pnpm dev      # open the printed URL
pnpm test     # physics, settings and WebMCP tests
pnpm lint     # oxlint (pnpm lint:fix applies the safe fixes)
pnpm format   # oxfmt (pnpm format:check only checks)
pnpm build    # type-check and build into dist/
```

**The game screen.** The 3D view fills the page.
- **Flight HUD** (bottom-left): altitude, speed, driver g-load and thrust as a multiple of the
  car's weight, with a roll dial and the phase.
- **Launch** plays the hop, and playback loops. The first time a run ends, a strip at the
  bottom says how it went (stuck the landing, hard landing, crash, or grounded) with the peak
  thrust, driver peak g, nitrogen used and the highest point, then fades.
- **Tweak it** (top-right) changes the settings with the biggest effect: mass at liftoff,
  hop height, range, the number and direction of barrel rolls, and the roll's duration. It
  also has a few display switches: smoke, glow, flight path, ghost trail (snapshots of the car
  along its path), the real-stunt car and force arrows (off by default). Its status line says whether the flight still works. A higher or
  lower hop, another number of rolls or a different roll time needs a different time in the
  air than the footage's 3.0 s, so the card fits the air time to the nearest one that flies
  (preferring the footage's) and says when it did; the hop-height and roll-time sliders cover
  the range where that works from the stunt's settings. The Lab sets every value exactly as
  given, over each setting's full range.
- **The dock** (bottom): play, speed, the time scrubber, camera presets (Wide, Footage cam,
  End-on, Chase, Top), **Real footage**, **ft / m** units, and the four charts. The charts
  collapse with **Charts ▾**; that choice and the units are remembered (on a phone the charts
  start hidden on every visit). The footage window shows on
  every load; drag it by its grip or picture to move it (double-click puts it back), between
  the top bar and the dock, or on a phone over the dock too.
- **Lab** (top-right, or **L**): a drawer with **Live** readouts, the whole-hop **Results**,
  and **Parameters**, where every setting, the flight model, display and rendering options
  can be changed. The results recompute straight away.
- **Share** copies a link to this exact flight. **About** has how it works, the credits and
  the keys.

Keys: **space** plays or pauses (or launches), **← / →** steps a frame, **Home** goes to the
start, **R** replays, **C** cycles the cameras, **F** shows the footage, **L** opens the Lab,
**Esc** closes the result strip or the Lab. While paused mid-hop, a hint at the bottom of
the view shows the space and arrow keys (on a touch screen: tap ▶). Clicking or dragging any chart scrubs to that time.
Imperial is the default unit system. The physics runs in SI throughout; units are converted
only for display. The top bar has Share and About, then (quieter, as they leave the
simulation) the Guide, the WebMCP page, GitHub and the making-of blog, and the Lab. Those
links come from one partial (`src/partials/site-links.html`) that the reading pages' header
includes too, after a **Simulation** link back and **About**. That's `/about/`, the About
dialog's text as a page, built from the same source (`aboutHtml()` in `src/ui/about-text.ts`). The
page also works on
phones: those links move into a ☰ menu; **Tweak** opens the Tweak card as a sheet (hidden
otherwise); **↺ Reset** appears beside it once the settings differ from the real stunt's, and
there every Reset asks first. The dock wraps, the charts swipe (‹ › page them where a mouse
can't swipe), and a row that scrolls fades on the side with more.

**Invalid settings.** If the settings make the car hit something (a parked vehicle, the
stage or the road), land hard, or not fly at all, a red notice under the top bar says so. It shows the first problem in full, with a **Show** button that frames the
spot in the 3D view and plays it from just before; later problems (mostly consequences of
the first) and other warnings fold into "n more". As playback reaches a problem, a red ring
and label appear where it happens, the vehicle or stage that is hit is outlined in red, and
the car is outlined in red while it is inside it; the charts and the time scrubber are
marked in red at the same moment. If the spot is off-screen or behind a panel, a red chip at
the edge of the view points to it (click it to frame the spot). With no feasible flight the
car stops at its launch point, short of the stage, marked **No feasible flight**; in the
closed-loop model a car that can't hold itself up is marked **Can't climb**.

**Settings in the URL.** Every setting in the Lab's Parameters panel is also a URL query
parameter, so a configuration can be opened (or shared, or requested by a script) with a
plain GET:

```
http://localhost:5173/?mass=1500&apexHeight=8&model=ideal
```

Values are in SI units whatever the display units (meters, kilograms, newtons, pascals,
m/s; times in seconds, angles in degrees), written as plain decimals (`-8`, `−8`, `2.5e-2`;
not hex). `model=controlled` (default) or `model=ideal` picks the flight model. Values
that aren't numbers, are outside a setting's range or should be whole, and repeated
parameters, are ignored and listed in the banner under **Ignored in the URL**. Parameters
that aren't settings (e.g. tracking tags) are left in the URL untouched; one that looks
like a mistyped setting is flagged ("did you mean mass?"). As settings change in the
panel, the address bar follows, listing only what differs from the defaults (to 12
significant digits). **Reset** returns the settings to their defaults and keeps the
flight model. The car's dimensions, drag areas other than from above, air density and
tank performance are fixed constants, not settings.

**Compare with the defaults.** When the settings differ from the defaults (from the URL or
the panel), the 3D view also shows the default, footage-matched run in the same flight model.
Its CG path is a dashed grey line, and a translucent copy of the car (the **real-stunt car**)
flies it in step with playback. Times are from liftoff in both runs. The default run is
simulated once per flight model, just after the page first draws, so opening a URL isn't held
up. The **Real-stunt car** switch (Tweak it, or the Lab's Display folder) turns the comparison
off.

**Explore a setting.** `explore=<setting>` (e.g. `/?explore=apexHeight`) flies that setting
lower and higher than it is, beside your run: an orange and a violet copy of the car, each
with its path. Each value is about a quarter of the setting's range away, moved back toward
yours until the hop still flies; where the plan needs it, the air time is fitted to it, as
the Tweak card does (`src/physics/explore.ts`). A panel at the top of the Tweak card names the
setting and compares the runs' air time, peak thrust, nitrogen and g-load. The real-stunt car
is hidden meanwhile. Each card in [the Guide](https://flyingcar.pet/guide/) links
to its comparison, and each Lab hint has **Compare lower and higher**. Any settings change
works the comparison out again, in a Web Worker (`src/physics/explore.worker.ts`) a moment
after the last change, so the view keeps moving; ✕ ends it. A Closed-loop flight setting
explored in the Ideal model says it doesn't apply there.

| Parameter | Setting | Unit | Default | Range |
|---|---|---|---|---|
| `footageSlowdown` | Footage slow-mo factor | — | 1 | 0.5 – 3 |
| `airTimeVideo` | Air time on screen | s | 3 | 1.5 – 4 |
| `apexHeight` | Apex CG height | m | 8.5 | 3 – 10 |
| `range` | Range liftoff→touchdown | m | 37.5 | 15 – 45 |
| `apexX` | Apex past the Semi | m | 1.7 | −8 – 8 |
| `sustainThrustG` | Sustained lift thrust | g | 0.3 | 0 – 1.2 |
| `invertedThrustG` | Extra lift while inverted | g | 0 | 0 – 2 |
| `launchBurnVideo` | Launch burn on screen | s | 0.32 | 0.1 – 1 |
| `touchdownSpeed` | Touchdown speed | m/s | 2.5 | 0 – 5 |
| `rollStartVideo` | Roll start on screen | s | 0.52 | 0 – 1.5 |
| `rollDurationVideo` | Roll duration on screen | s | 1.94 | 0.5 – 2.8 |
| `rollRampVideo` | Roll spin-up time on screen | s | 0.25 | 0.05 – 1.4 |
| `rollStopVideo` | Roll stop time on screen | s | 0.26 | 0.02 – 1 |
| `rollOvershootDeg` | Roll overshoot past level | ° | 6 | 0 – 30 |
| `rollSettleVideo` | Overshoot correction time | s | 0.14 | 0.02 – 0.8 |
| `rollTurns` | Barrel rolls (negative = toward the noses) | — | −1 | −3 – 3, whole |
| `mass` | Mass at liftoff | kg | 2000 | 1200 – 3000 |
| `cgHeight` | CG height at rest | m | 0.5 | 0.35 – 0.7 |
| `inertiaScale` | Inertia vs uniform box | — | 0.8 | 0.5 – 1.2 |
| `isp` | Specific impulse | s | 70 | 40 – 80 |
| `liftThrusterMax` | Lift thruster rating | N | 32000 | 5000 – 60000 |
| `rcsThrusterMax` | Side thruster rating | N | 25000 | 2000 – 30000 |
| `tankPressure` | Tank pressure | Pa | 30000000 | 10000000 – 70000000 |
| `usableFraction` | Usable gas fraction | — | 0.85 | 0.5 – 0.95 |
| `suspensionTravel` | Suspension travel | m | 0.12 | 0.04 – 0.3 |
| `brakingDecel` | Slide deceleration | m/s² | 6 | 2 – 10 |
| `driftYawDeg` | Slide yaw | ° | 0 | 0 – 270 |
| `cdaTop` | Drag area from above | m² | 7.5 | 2 – 12 |
| `gustStd` | Gusts | m/s | 1.5 | 0 – 6 |
| `thrustScatter` | Thruster output error | fraction | 0.04 | 0 – 0.2 |
| `thrustNoise` | Thrust fluctuation | fraction | 0.05 | 0 – 0.3 |
| `cgOffset` | Center-of-mass error | m | 0.03 | 0 – 0.15 |
| `inertiaError` | Inertia error | fraction | 0.1 | 0 – 0.4 |
| `valveLag` | Valve response time | s | 0.03 | 0 – 0.12 |
| `minOpening` | Smallest steady opening | fraction | 0.08 | 0 – 0.4 |
| `controlRate` | Controller rate | Hz | 100 | 20 – 480, whole |
| `posBandwidth` | Path-tracking bandwidth | rad/s | 2.5 | 0.5 – 8 |
| `attBandwidth` | Attitude bandwidth | rad/s | 10 | 2 – 30 |
| `seed` | Disturbance seed | — | 1 | 1 – 999, whole |

**WebMCP tools.** The page registers its controls as [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools on `document.modelContext`, so an AI agent in the browser can use the simulator. Where
the browser has no native WebMCP, the `@mcp-b/global` polyfill provides it, loaded just after
the first frame is drawn and answering only this window (not other origins or embedding frames); it
needs a secure context (https or localhost). `window.webmcpTools.ready` says when the tools
are registered. Settings use the same names, SI units, ranges and checks as the URL
parameters, and go inside `settings` (e.g. `{"settings": {"mass": 2400}}`); misplaced or
mistyped arguments are refused with a message rather than ignored. In the ideal model the
reported forces are what the fitted flight requires; in the closed-loop model, what the
thrusters delivered. A simulation takes about 0.2–4 s and runs on the page's main thread.
Worked examples (an agent's calls, the browser console, the bridge) are in
[docs/webmcp.md](docs/webmcp.md); `tests/webmcp.e2e.test.ts` runs them.

| Tool | Does |
|---|---|
| `get_settings` | Every setting keyed by name: `values` (the current values, which can be passed straight back as `settings`) and `settings` (each one's unit, range, default and current value); the flight model; the page URL |
| `set_settings` | Change `settings` and/or `model` (optionally `reset: true` first, which keeps the model) on the page; returns what was applied, what was rejected and why, and the new results |
| `load_url` | Load a shareable URL of this page (or just its query, `?mass=2600`) the way opening it would (the defaults, then its settings and model) without reloading; returns what was applied, which URL parameters were ignored and why, and the results |
| `get_results` | The run on the page: `valid`, `flies`, `planFeasible`, incidents (collisions, hard or tilted landing, an infeasible plan, can't climb, never lands; each with a time and place), warnings, the forces, gas and loads, each nozzle's peak against its rating, and the clearance over each vehicle |
| `simulate` | A what-if: the results for the current settings (or the defaults, with `fromDefaults: true`) with some changed, without touching the page, plus that run's URL |
| `find_feasible` | For the current settings (or a what-if), where the flight plan becomes or stays feasible as single settings move, each on its own: by default air time, apex height, roll duration and sustained thrust (or the settings in `vary`). Slow: about 3–10 s per setting |
| `get_state_at` | Position, velocity, roll, thrust per thruster and more at a time `t`, or at up to 200 `times` |
| `show` | Jump to a time, play or pause, pick a camera preset, or frame an incident and play it (or, with `play: false`, pause exactly at it) |

`get_results`, `simulate`, `set_settings` and `load_url` all end the same way: `flightModel`,
`settingsChangedFromDefaults`, `url` and `results`. `set_settings` and `load_url` also return
`applied` and `rejected` (with reasons); `simulate` returns `changed`. The results have the
same keys whether or not the car flies (`closedLoop` is `null` outside a closed-loop flight).
When no flight plan meets the settings (an `infeasible-plan` incident: the car stays at its
launch point), the flight's figures, nested blocks included, are `null`, and a `hint` points
at `find_feasible`.

The plan's feasibility hinges on a few settings that depend on each other: a higher apex
needs a longer air time, which needs a roll that ends in time, and so on. For an infeasible
plan, `find_feasible` gives the nearest feasible values below and above each setting. For a
feasible one, it gives the window each setting can move in. It steps outward from the
current value and bisects the edge to about 1/8 of the setting's slider step, and checks each
value it returns. A feasible stretch narrower than its first step (1/32 of the setting's
range) can be missed. A plan's landing burn may push at most 5 × the car's weight, the load
that counts as a hard landing; plans near an edge use most of that, so back off from an edge
for an easier flight. It checks the plan only, so `simulate` a candidate to check for
collisions, the landing and the thruster ratings. `hint` is `null` when the plan is feasible.

For command-line agents and scripts, `pnpm webmcp:bridge [appUrl] [port]` keeps a headless
Chrome on the app and relays HTTP calls to those same tools through `getTools` and
`executeTool`. It waits for the tools (and again after a page reload), answers only local
clients, and stops on Ctrl-C. Chrome is looked for at `/usr/bin/google-chrome` (set
`CHROME_PATH`); its flags default to the real GPU through EGL on Linux (set `CHROME_ARGS`).

```sh
pnpm dev                             # http://localhost:5173/
pnpm webmcp:bridge                   # http://localhost:8787
curl -s localhost:8787/tools
curl -s localhost:8787/call -d '{"name":"simulate","arguments":{"settings":{"mass":2400}}}'
curl -s -X POST localhost:8787/screenshot    # saves a PNG of the page, returns its path
curl -s localhost:8787/navigate -d '{"url":"/?mass=2600&apexHeight=10"}'   # open another URL of the app
```

`appUrl` can carry settings too (`pnpm webmcp:bridge 'http://localhost:5173/?mass=2600'`).
`/navigate` loads the app's page afresh with another query (it refuses other origins and
paths). If the tools don't come up there, it goes back to the page it was on. The `load_url` tool applies a URL's
settings to the page already open.
Every call answers `{"result": …}`, or `{"isError": true, "result": {"error": …}}`.
`tests/webmcp.e2e.test.ts` checks the real page in Chrome (skipped if Chrome can't start).

**Footage panel.** On the website, the source video plays in a window at the top left, synced
to the simulation clock: it follows play, pause and scrubbing frame by frame. Pick which of the four
camera views to show; each is aligned on its own liftoff, and the panel says when the current
moment falls outside that shot. For the front view, **Match camera** (or the **Footage cam**
preset) puts the 3D camera where the footage camera was, solved against the parked
line-up, so the two pictures line up. **⤢** enlarges the panel; **Real footage** in the bottom
bar (or **F**) shows or hides it; it shows on every load (hiding it lasts until a reload). The panel credits and links the original
post. It draws still frames rather than playing the video, because hardware video decoding
stalls on seek and play on some GPUs: every frame of the four shots (0:03.3
to 0:31.28) at 640 × 360, served from `/footage/frames/NNNNN.jpg` (numbered as in the video)
with `/footage/frames.json` (`{ "fps", "first", "last", "width", "height" }`). **The footage
is not part of this repository.** Without it the page hides the panel and its toggle, and
everything else works the same.

## How it works

The roll is fitted to the footage, the lift-jet thrust is specified as the footage shows it, the
flight path is integrated from that thrust, and the forces are then worked out (`src/physics/`):

1. **Roll** (`profile.ts`). Fitted to the car's attitude frame by frame: a gentle spin-up, a
   near-constant rate, a hard stop a few degrees past level, and a quick correction back.
2. **Thrust-driven flight** (`flight.ts`). The lift jets fire along the car's own up axis for
   the whole hop, as they do in every frame of the footage:
   - a launch burn, sized so the center of mass reaches the measured apex;
   - a sustained thrust (0.3 g) through the roll. It can be raised while the car is upside
     down (**Extra lift while inverted**, fading out by 90° either side) to pull it back down
     sooner after a high apex; the footage doesn't need it, so it is off by default;
   - a landing burn, solved so the car reaches ride height at the air time at the touchdown
     speed.

   Because that thrust turns with the roll, it pushes the car up while upright, **toward the
   line-up's noses while the roof faces them (which produces the ≈ 2 m sideways drift by
   itself)**, and down while inverted. The car rolls by firing its left and right lift
   thrusters unevenly, and no thruster pushes it down, so a roll torque τ needs at least
   |τ| / (lever arm) of lift: wherever the roll speeds up or stops faster than the scheduled
   thrust allows, the lift is raised to that minimum (1.4 g at the spin-up, 1.55 g for
   the correction before landing). Height and sideways position are integrated from all of
   it; forward motion is drag-only. The approach speed is solved so the car covers the
   measured range, and the suspension then absorbs the touchdown.
3. **Newton** (`timeline.ts`). The force the thrusters must supply is F = m·a − m·g − D
   (D is attitude-dependent drag). It is converted into the car's rotating frame.
4. **Euler.** The torque needed about the center of mass is τ = I·α + ω × (I·ω).
5. **Allocation** (`allocation.ts`, `nnls.ts`). The force and torque on all three axes are split
   across six thrusters using weighted non-negative least squares, because thrusters can only
   push. The layout follows the footage: 4 down-firing lift thrusters just inboard of the
   wheels, and 2 front side thrusters at the front corners exhausting outward (the left one is
   visible at 0:26.8). The side thrusters sit only ≈ 0.2 m below the center of mass, so they
   roll the car weakly and mostly yaw it; the allocation keeps them for the small sideways
   forces.
6. **Gas.** Each nozzle uses gas at ṁ = F / (Isp·g₀). The tank volume comes from the density of
   N₂ at the storage pressure, and the tank mass from a typical carbon-wrapped (COPV) tank
   performance factor.

`tests/physics.test.ts` checks that the derived forces, integrated back through F = ma,
reproduce the trajectory on all three axes. It also checks that the thrusters deliver the
required torque and that gas use equals impulse / (Isp·g₀).

### Two flight models

The **Flight model** selector at the top of the Lab's Parameters panel switches between:

- **Closed-loop** (default, `closedloop.ts`). The car is simulated forward as a rigid body,
  moved only by the thrust its thrusters actually deliver, under a flight controller that
  tracks the ideal flight. The controller runs at 100 Hz: feedforward from the ideal flight
  (led by the valve lag it expects, so the short landing burn arrives on time), plus
  feedback on position and velocity and a geometric attitude controller, through the same
  thruster allocation. Things go wrong the way they do on a real vehicle:
  - each thruster delivers a few percent more or less than commanded, with fast fluctuation;
  - valves respond with a lag and below a minimum opening can only pulse;
  - the center of mass is a few centimeters from where the controller assumes it;
  - the inertia is mis-estimated, and gusts change the drag.

  So the thrusters flicker and correct constantly, and the flight lands close to, not
  exactly on, the ideal path. The Results tab shows the tracking error, landing point,
  touchdown speed and the gas used compared with the ideal flight. Every disturbance is adjustable in the
  **Closed-loop flight** folder; the seed makes runs repeatable, and **New disturbance draw**
  flies it again with different luck. `tests/closedloop.test.ts` checks that with every
  disturbance off, the forward simulation reproduces the ideal flight (within 2 cm and 0.3°).
- **Ideal**. The exact minimum thrust for the fitted path, worked back from the motion as
  described above: no errors, so nothing to correct.

### Rendering

- **Vehicles** are the GLB models in `compressed-glbs/` (see [Vehicle models](#vehicle-models)),
  prepared on load by `src/scene/glb.ts`. Until they load, or if they can't, procedural
  stand-ins are shown (`src/scene/loft.ts`, `models.ts`, `parked.ts`), lofted from
  cross-sections; the Roadster's profile was traced from the side-on frame at 0:31.6.
- **Smoke** (`src/scene/smoke.ts`) is sorted, lit billboard particles, kept short-lived so it
  shows where gas and tire smoke come from. Jets slow as they mix with the air, widen with
  distance and turn turbulent, then fan out briefly along the ground. The bright jet cores at
  the nozzles are in `effects.ts`; light strips are band-limited glow lines (`glow.ts`) so they
  don't flicker as the camera moves.

## Measured from the video

The footage shows **one run filmed by four cameras**, played one after another:

| View | Video time of liftoff |
|---|---|
| End-on | 0:08.08 |
| Front | 0:12.81 |
| Side-wide | 0:19.00 |
| Side-close | 0:25.93 |

Liftoff is the start of the launch burn, measured frame by frame in the side-wide view: the
body starts to rise at 0:19.00 (±0.02 s), and the wheels leave the ground about 0.15 s later,
once the suspension has extended. The other views are synchronized on the roll, which they all show. In the
end-on, side-wide and side-close views the red tail-light bar gives the roll angle directly; in
the front view it's estimated by eye. On this common clock, every view passes the same roll
angles at the same moments to within ±0.04 s. The front view's liftoff was then refined by one
frame, from 0:12.85 to 0:12.81. That fits the car's early heights in that view, measured
against its solved camera, best together with the side-wide rise. The footage panel uses the
same times.

The front view is filmed by a static camera whose position and lens were solved against the
parked line-up (light bars land within about 5 px).

| | Value |
|---|---|
| Launch | **≈ 3.5–3.7 g of thrust for ≈ 0.4 s**, measured from the side-wide view frame by frame; that camera sees the car recede as it flies toward the line-up (its apparent length falls ≈ 20% by 0.7 s), so each frame is scaled by the car's own length. Measured: ≈ 36 ft/s (11 m/s) upward and the center of mass ≈ 19 ft (5.8 m) up by 0.7 s. The front view's solved camera shows the early climb directly from the car's roof line while it is upright: 8.5 ft (2.6 m) at 0.3 s, then already slowing (≈ 17 ft, 5.2 m, at 0.7 s). The launch burn, apex height and the front view's liftoff were fitted to both views and the front view's later track together: **3.9 g for 0.32 s**, solved from the apex, 0.36 m rms overall. The front view's early heights are still ≈ 1–1.5 ft (0.3–0.5 m) above the fit, and the side-wide rise's last frames up to ≈ 3 ft (0.9 m) |
| Liftoff → touchdown | **≈ 3.0 s**, at ≈ 8 ft/s (2.5 m/s). In the side-wide view the car's tail-light bar is still dropping against the stage strip at 0:21.98 (2.98 s), slowing from ≈ 7 m/s at 2.7 s; the landing-burn jets bury the wheels in smoke from ≈ 2.8 s, which is easy to mistake for touchdown. The end-on view agrees: level with the Semi's top at 2.5 s, tire smoke at 3.0 s |
| Roll | one full turn **toward the line-up's noses**: starts ≈ 0.52 s, near-steady ≈ 217°/s, stops ≈ 6° past level at 2.46 s, corrected back to level by 2.60 s. Fitted to all four views at once: rms 6.9°, 1.9° in the end-on view (which looks straight at the tail) |
| Apex (center of mass) | ≈ 28 ft (8.5 m), ≈ 1.5 s after liftoff (≈ 8.3 m in the front view's track, ≈ 9 m against the Semi in the side-wide view); still ≈ 23 ft (7.0 m) at 2.0 s, as the front view shows |
| Apex position | ≈ 5.6 ft (1.7 m) past the Semi |
| Ground speed | ≈ 41 ft/s (12.4 m/s) in flight (42 ft/s, 12.8 m/s, on the approach); range ≈ 123 ft (37.5 m). Fitted to the front view by the car's trailing edge every 0.05 s from 0.5 to 2.35 s: the gap to the footage stays within ≈ 0.33 m rms, with no drift. The real car moves at a steady speed; a forward push doesn't fit better |
| Sideways drift | ≈ 6.6 ft (2 m) toward the noses (end-on view, 0:09–0:10); the rotating lift thrust gives 5.7 ft (1.74 m) |
| Lift jets | lit in every frame of the flight, pointing out of the car's underside (down at launch, up while inverted) |
| Thrusters | 4 down-firing lift thrusters and 2 front side thrusters; nothing pushes the car down (side-close view, 0:26.8) |
| Line-up | Model 3, Model Y, Semi, Cybertruck, Cybercab (viewed from the front), ≈ 12 ft (3.6 m) apart on a 0.5 ft (0.15 m) stage |

## Headline results (defaults)

These are for the **ideal** flight model; the closed-loop model's corrections change them
slightly (see the Results tab).

| | Imperial | SI |
|---|---|---|
| Launch thrust | **17,180 lbf**, 3.9 × weight, for 0.32 s | 76.4 kN |
| Sustained lift thrust | ≈ 1,320 lbf, 0.3 × weight, turning with the roll | 5.9 kN |
| Lift for the roll | raised to at least 1.4 g at the spin-up and 1.55 g during the correction before landing | |
| Landing-burn thrust | 10,860 lbf, 2.6 × weight, from 2.65 s | 48.3 kN |
| Peak roll torque | 14,100 lbf·ft; roll rate 217°/s. Busiest nozzle 4,300 lbf (a lift thruster at launch) | 19.1 kN·m; 19.1 kN |
| Total impulse | 14,050 lbf·s | 62.5 kN·s |
| Nitrogen used | **≈ 201 lb** (≈ 90 gal at 4,350 psi, ≈ 90 lb of tanks) | 91 kg (341 L at 300 bar, 41 kg of tanks) |
| Peak exhaust power | 35,300 hp | 26.3 MW |
| Driver | peak 3.9 g | |
| Clearance | ≥ 7.2 ft from everything; nearest is the Cybercab on the way up | 2.2 m |
| Touchdown | 15,380 lbf on the tires at 8 ft/s. Without the braking burn: 28 mph impact, ≈ 68 × weight | 68.4 kN at 2.5 m/s; 12.5 m/s |
| Mass | 4,409 lb at liftoff, 4,209 lb at touchdown (the expelled nitrogen) | 2,000 kg → 1,909 kg |

## Vehicle models

The vehicles are meshopt-compressed GLB models with WebP textures, in `compressed-glbs/`.
None of them is the original: each file is a modified version (simplified or edited) of the
Sketchfab model credited below, and the Cybercab was generated from two other Sketchfab
models, both credited in its row. They are
modified again for this scene (the credits, licenses and that note are also in the site's
About dialog). On load, `src/scene/glb.ts`:

- **tints the windows** dark and opaque (large glass; small light covers stay clear);
- **removes what can't be seen from outside**: each triangle is drawn in its own color from 48
  directions all round (the car flies upside down, so from below too), with the tinted windows
  hiding what is behind them, and triangles that never show (the interiors) are dropped;
- simplifies meshes that are still heavy (meshoptimizer), and swaps glass transmission (which
  renders the scene again) for plain transparency;
- turns, centers and scales each model to its vehicle's length (the Roadster to the physics
  model's 4.3 m), and separates the Roadster's wheels (found from the tire treads, since the
  files merge parts that share a material) so they spin;
- casts each vehicle's shadow from an invisible box instead of its full mesh.

That takes the scene from ≈ 1.35 million triangles to ≈ 0.43 million, about the frame rate of
the procedural stand-ins. Collisions and the physics still use the dimensions in
`src/physics/layout.ts` and the settings, not the meshes.

Each modified model is shared under the same license as the original it is based on (the
table below; the details, with the license links and the changes made, are in
[`compressed-glbs/LICENSE.md`](compressed-glbs/LICENSE.md)). The MIT license of this
repository does not cover them.

| File (modified) | Based on | Author | License |
|---|---|---|---|
| `tesla_roadster_2020.glb` | [Tesla Roadster 2020](https://sketchfab.com/3d-models/tesla-roadster-2020-1fbf29e297bd4a17ac39a00a378441d8) | metarex.4d | CC BY 4.0 |
| `tesla_model__3_2024.glb` | [Tesla Model 3 2024](https://sketchfab.com/3d-models/tesla-model-3-2024-36c52f3f89f6439c90310f14e8ff33f2) | brandonleong28 | CC BY 4.0 |
| `2025_tesla_model_y.glb` | [2025 Tesla Model Y](https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74) | BloxBloger | **CC BY-NC 4.0** (non-commercial) |
| `tesla_cybertruck.glb` | [Tesla Cybertruck](https://sketchfab.com/3d-models/tesla-cybertruck-3e72defa993c4d81b9deb2eee1ee6054) | neshallads | CC BY 4.0 |
| `tesla_semi.glb` | [Tesla Semi](https://sketchfab.com/3d-models/tesla-semi-39ffc7c746184e0c9ebd5bbcd0b405dd) | Aleksei Rozumnyi | CC BY 4.0 |
| `cybercab-generated.glb` | Cybercab, generated from [cybercab](https://sketchfab.com/3d-models/cybercab-81296685568f43b9a773cb4ebdd42c02) and [Tesla Cybercab 3D Model](https://sketchfab.com/3d-models/tesla-cybercab-3d-model-45c25fd8442b45129e47be2e66449ca3) | onurd; Grass Grass Grass | CC BY 4.0 |

## Assumptions and caveats

- **Mass, thruster layout, Isp and tank figures are estimates.** Tesla hasn't published them.
  Defaults: 4,409 lb (2,000 kg), nitrogen cold gas at Isp 70 s, 4,350 psi (300 bar) tanks.
- **Playback speed.** The model assumes the footage runs in real time. Setting the slow-mo
  factor to 2 makes the maneuver infeasible: the car would have to come down faster than free
  fall. That is good evidence the shot is real-time, or CGI made to obey real gravity.
- The inertia is a uniform box scaled by 0.8, and doesn't change as gas is used. The mass does
  decrease as gas is expelled.
- The thruster split minimizes the sum of squared nozzle forces. That spreads the load evenly;
  it is not the minimum-gas solution.
- Plumes and smoke are visual only.
- The sideways drift is measured from a shot where the camera tracks slightly, so its size
  (≈ 2 m) is approximate.
- **Height fit.** The simulation follows the side-wide launch rise to ≈ 0.2 m rms and the
  front view's track to ≈ 0.4 m (at most ≈ 0.9 m) up to 2.2 s. After that the car runs off
  the left edge of the front view and the tracker, which follows its clipped outline, no
  longer measures it; the side-wide and end-on views cover the descent instead. The
  largest gap is just after the launch (≈ 0.7 s), where both views put the car ≈ 1 m
  higher than the simulation. Side-wide heights use the car's apparent length as a scale,
  which roll and pitch also shorten; front-view heights assume the car's distance from
  that camera.
- Vehicle dimensions are official figures except the Semi (estimated) and the Cybercab's
  length (unpublished; 4.3 m assumed). The line-up spacing is scaled from one head-on frame.

## License

The code is released under the [MIT License](LICENSE).

That doesn't cover:

- **The vehicle models** in `compressed-glbs/`: modified versions of the credited Sketchfab
  models, each under the same license as its original (CC BY 4.0; the Model Y is CC BY-NC
  4.0, non-commercial). See [`compressed-glbs/LICENSE.md`](compressed-glbs/LICENSE.md).
- **The fonts** (Inter and Rajdhani, installed from npm): SIL Open Font License.
- **The bundled libraries** (three.js, lil-gui, the WebMCP polyfill, …) keep their own
  licenses; the build collects them into `licenses.md`, served with the site.
- **The original video**, which belongs to Tesla and is not included here.

flyingcar.pet is an independent fan project, not affiliated with Tesla. Tesla, Roadster,
Model 3, Model Y, Cybertruck, Cybercab and Semi are Tesla's trademarks, used only to name the
vehicles.
