// A WebMCP bridge for command-line agents and scripts: keeps one headless Chrome on the
// app and relays calls to the page's WebMCP tools (document.modelContext) over HTTP.
//
//   pnpm dev                          # in one terminal
//   pnpm webmcp:bridge [appUrl] [port]
//   curl -s localhost:8787/tools
//   curl -s localhost:8787/call -d '{"name":"simulate","arguments":{"settings":{"mass":2400}}}'
//   curl -s -X POST localhost:8787/screenshot
//   curl -s localhost:8787/navigate -d '{"url":"/?mass=2600&apexHeight=10"}'
//
// appUrl may carry settings (http://localhost:5173/?mass=2600), as may /navigate's URL,
// which opens another page of the same app in the bridge's browser (a full page load; the
// load_url tool applies a URL's settings without one).
// Only the WebMCP API is used (getTools / executeTool), the same calls a browser agent makes.
// Every /call answers {"result": …} or {"isError": true, "result": {"error": …}}.
// CHROME_PATH and CHROME_ARGS override the browser and its flags (the defaults use the
// real GPU through EGL on Linux).
import http from 'node:http';
import { chromium } from 'playwright-core';

const appUrl = process.argv[2] ?? 'http://localhost:5173/';
const port = Number(process.argv[3] ?? 8787);
const READY_TIMEOUT = 30_000;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: (
    process.env.CHROME_ARGS ?? '--use-gl=angle --use-angle=gl-egl --ozone-platform=headless --ignore-gpu-blocklist'
  ).split(' '),
  handleSIGINT: false,
  handleSIGTERM: false, // shut down ourselves, below
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.error('[page error]', e.message));

/** Resolves once the page's tools are registered (again after any reload), or throws. */
let ready = null;
const waitForTools = () =>
  (ready ??= (async () => {
    const handle = await page
      .waitForFunction(
        () => {
          const s = window.webmcpTools;
          return s && (s.ready || s.error) ? s : false;
        },
        null,
        { timeout: READY_TIMEOUT, polling: 100 },
      )
      .catch(() => null);
    const state = handle ? await handle.jsonValue() : null;
    if (!state)
      throw new Error(`No WebMCP tools appeared on ${page.url()} within ${READY_TIMEOUT / 1000} s (is it this app?).`);
    if (state.error) throw new Error(`The page could not register its WebMCP tools: ${state.error}`);
    const n = await page.evaluate(async () => (await document.modelContext.getTools()).length);
    if (n !== state.count) throw new Error(`The page registered ${state.count} tools but WebMCP lists ${n}.`);
    return n;
  })().catch((e) => {
    ready = null; // try again on the next request
    throw e;
  }));
// A reload (e.g. a Vite full reload) re-registers the tools: wait again from its start.
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) ready = null;
});

await page.goto(appUrl);
try {
  console.log(`${await waitForTools()} WebMCP tools on ${appUrl}`);
} catch (e) {
  console.error(e.message);
  await browser.close();
  process.exit(1);
}

const listTools = () =>
  page.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  );

const callTool = (name, args) =>
  page.evaluate(
    async ([name, args]) => {
      const tool = (await document.modelContext.getTools()).find((t) => t.name === name);
      if (!tool) return { isError: true, result: { error: `There is no tool named ${JSON.stringify(name)}.` } };
      let raw;
      try {
        raw = await document.modelContext.executeTool(tool, args ?? {});
      } catch (e) {
        return { isError: true, result: { error: String(e?.message ?? e) } };
      }
      let out;
      try {
        out = JSON.parse(raw);
      } catch {
        return { result: raw };
      }
      // Unwrap an MCP text result whose text is JSON, for readable output.
      const text = out?.content?.length === 1 && out.content[0].type === 'text' ? out.content[0].text : null;
      let result = out;
      if (text !== null) {
        try {
          result = JSON.parse(text);
        } catch {
          result = text;
        }
      }
      return out?.isError ? { isError: true, result } : { result };
    },
    [name, args],
  );

/** Only same-machine pages and command-line clients (no Origin) may call. */
const allowedOrigin = (origin) => !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 1));
  };
  if (!allowedOrigin(req.headers.origin))
    return send(403, { isError: true, result: { error: 'Requests from other sites are not allowed.' } });
  /** The JSON body, or null after answering 400 with the expected shape. */
  const readJson = async (shape) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      return JSON.parse(body || '{}');
    } catch {
      send(400, { isError: true, result: { error: `The body must be JSON: ${shape}` } });
      return null;
    }
  };
  try {
    if (req.method === 'GET' && req.url === '/tools') {
      await waitForTools();
      return send(200, await listTools());
    }
    if (req.method === 'POST' && req.url === '/call') {
      const request = await readJson('{"name": "...", "arguments": {...}}');
      if (!request) return;
      await waitForTools();
      return send(200, await callTool(request.name, request.arguments));
    }
    if (req.method === 'POST' && req.url === '/navigate') {
      const request = await readJson('{"url": "..."}');
      if (!request) return;
      if (typeof request.url !== 'string')
        return send(400, {
          isError: true,
          result: { error: '"url" must be a string: a URL of the app, or a path and query ("/?mass=2600").' },
        });
      let target;
      try {
        target = new URL(request.url, page.url());
      } catch {
        return send(400, { isError: true, result: { error: `${JSON.stringify(request.url)} is not a URL.` } });
      }
      const app = new URL(appUrl);
      if (target.origin !== app.origin || target.pathname !== app.pathname) {
        return send(400, {
          isError: true,
          result: { error: `Only the app's page (${app.origin}${app.pathname}, with any query) can be opened.` },
        });
      }
      // If the page doesn't come up with its tools, go back to the one that worked.
      const previous = page.url();
      try {
        ready = null;
        await page.goto(target.href);
        const tools = await waitForTools();
        return send(200, { result: { url: page.url(), tools } });
      } catch (e) {
        ready = null;
        await page.goto(previous).catch(() => {});
        return send(502, { isError: true, result: { error: `${String(e?.message ?? e)} Went back to ${previous}.` } });
      }
    }
    if (req.method === 'POST' && req.url === '/screenshot') {
      const path = `/tmp/webmcp-${Date.now()}.png`;
      await page.screenshot({ path });
      return send(200, { result: { path } });
    }
    send(404, {
      isError: true,
      result: {
        error: 'Use GET /tools, POST /call {"name", "arguments"}, POST /navigate {"url"}, or POST /screenshot.',
      },
    });
  } catch (e) {
    send(500, { isError: true, result: { error: String(e?.message ?? e) } });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`WebMCP bridge: http://localhost:${port} → ${appUrl}`));

let closing = false;
const shutdown = async (why) => {
  if (closing) return;
  closing = true;
  console.log(`Stopping (${why}).`);
  server.close();
  await browser.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
browser.on('disconnected', () => shutdown('the browser closed'));
