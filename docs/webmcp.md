# Using flyingcar.pet with an AI agent (WebMCP)

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a draft from a W3C community group that lets a web page
offer **tools** to AI agents running in your browser. flyingcar.pet registers its controls as
eight tools on `document.modelContext`, so an agent can run the simulation for you: try a
heavier car, find the highest hop that still lands, or jump to the moment the car clears the
Semi.

- The tools run in your browser, in the page. Nothing is sent to the site.
- Where the browser has no WebMCP of its own, the page loads a polyfill
  ([`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global)) that provides it. It answers
  only this page's own window, and needs a secure context (https, or localhost).
- Settings use SI units (kilograms, meters, newtons, seconds), the same names and ranges as
  the URL parameters. `get_settings` lists them all.

<!-- web:skip -->
The same guide, formatted for the web, is at [flyingcar.pet/webmcp/](https://flyingcar.pet/webmcp/).
<!-- /web:skip -->

## The tools

| Tool | Does |
|---|---|
| `get_settings` | Every setting with its unit, range, default and current value; the flight model; the page URL |
| `set_settings` | Change settings (and/or the flight model) on the page itself |
| `load_url` | Apply a shareable URL's settings to the page without reloading |
| `get_results` | The run on the page: whether it flies, incidents, warnings, forces, gas, loads, clearances |
| `simulate` | A what-if: the results for changed settings, without touching the page, plus that run's URL |
| `find_feasible` | How far single settings can move before the flight plan stops working |
| `get_state_at` | Position, velocity, roll, thrust per thruster and more at chosen times |
| `show` | Jump to a time, play or pause, pick a camera, or frame an incident |

The full reference (every argument and result field) is in the
[README](https://github.com/closetheloop-dev/flying-car#readme).

## Three ways to use them

### 1. An agent in your browser

A browser with WebMCP, or an extension that connects an AI assistant to the page's tools
(such as [MCP-B](https://docs.mcp-b.ai/)), lets you just ask. Open
[flyingcar.pet](https://flyingcar.pet/), connect your agent, and ask, for example:

> Would the stunt still work with a 3,000 kg car? If not, what's the heaviest that does?

The agent works it out with `simulate`, which leaves the page alone:

| Call | Result |
|---|---|
| `simulate {"settings": {"mass": 3000}}` | flies, but `valid: false`: "Over rated force: the controller asked RL for more than their 32.00 kN rating …" |
| `simulate {"settings": {"mass": 2500}}` | `valid: true` |
| `simulate {"settings": {"mass": 2750}}` | `valid: true` |
| `simulate {"settings": {"mass": 2900}}` | `valid: true` |
| `simulate {"settings": {"mass": 2950}}` | `valid: true` |

So 3,000 kg still flies, but a lift thruster would have to push past its 32 kN rating; the
heaviest car that stays within the ratings (to 50 kg) is
[2,950 kg](https://flyingcar.pet/?mass=2950). With stronger lift thrusters,
`simulate {"settings": {"mass": 3000, "liftThrusterMax": 34000}}` is valid again
([try it](https://flyingcar.pet/?mass=3000&liftThrusterMax=34000)).

Another question, for `find_feasible`:

> What's the highest hop the flight plan allows, with everything else as filmed?

| Call | Result |
|---|---|
| `find_feasible {"vary": ["apexHeight"]}` | apex height from 7.47 m to **8.86 m** (the stunt: 8.5 m) |
| `simulate {"settings": {"apexHeight": 8.86}}` | flies, `valid: true`, no incidents |

So the hop can go about 0.36 m higher before the air time no longer allows a soft landing
([the 8.86 m hop](https://flyingcar.pet/?apexHeight=8.86)).

### 2. The browser console

The tools are a plain JavaScript API, so you can call them yourself. Open
[flyingcar.pet](https://flyingcar.pet/), open the developer tools' console, and paste:

```js
const tools = await document.modelContext.getTools();
const simulate = tools.find((t) => t.name === 'simulate');
const reply = await document.modelContext.executeTool(simulate, { settings: { mass: 3000 } });
const run = JSON.parse(JSON.parse(reply).content[0].text);
console.log(run.results.flies, run.results.valid, run.results.warnings, run.url);
```

It prints:

```text
true false ['Over rated force: the controller asked RL for more than their 32.00 kN rating (…)'] https://flyingcar.pet/?mass=3000
```

`executeTool` returns a JSON string: an MCP reply whose `content[0].text` is the tool's
result, itself JSON.

### 3. The command line

For agents and scripts outside the browser, the repository has a small bridge: it keeps a
headless Chrome on the page and relays HTTP calls to the same tools. It needs Node.js, pnpm and
Google Chrome. It looks for Chrome at `/usr/bin/google-chrome` with Linux GPU flags; elsewhere,
set `CHROME_PATH` to your Chrome and `CHROME_ARGS` to the flags to use instead.

```sh
git clone https://github.com/closetheloop-dev/flying-car.git
cd flying-car
pnpm install
pnpm webmcp:bridge https://flyingcar.pet/
```

Then, from another terminal:

```sh
curl -s localhost:8787/tools
curl -s localhost:8787/call -d '{"name":"simulate","arguments":{"settings":{"mass":3000}}}'
```

Every call answers `{"result": …}`, or `{"isError": true, "result": {"error": …}}`. The bridge
answers only local clients. See the README for its other endpoints (`/navigate`,
`/screenshot`).
