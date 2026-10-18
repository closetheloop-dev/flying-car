import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import guide from '../docs/webmcp.md?raw';

/**
 * The real page in Chrome: its WebMCP tools are registered, and changing settings through
 * them gives the same run as opening the URL for those settings. Skipped where Chrome
 * can't be started (CHROME_PATH / CHROME_ARGS as for the bridge).
 */
let server: ViteDevServer | null = null;
let browser: Browser | null = null;
let base = '';
let why = '';

beforeAll(async () => {
  try {
    browser = await chromium.launch({
      executablePath:
        (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CHROME_PATH ??
        '/usr/bin/google-chrome',
      args: (
        (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CHROME_ARGS ??
        '--use-gl=angle --use-angle=gl-egl --ozone-platform=headless --ignore-gpu-blocklist'
      ).split(' '),
    });
  } catch (e) {
    why = `Chrome is unavailable: ${String(e).split('\n')[0]}`;
    return;
  }
  server = await createServer({
    root: new URL('..', import.meta.url).pathname,
    server: { port: 5199, strictPort: false },
    logLevel: 'silent',
  });
  await server.listen();
  base = server.resolvedUrls!.local[0];
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function openApp(query = '') {
  const page = await browser!.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}${query}`);
  await page.waitForFunction(
    () => (window as unknown as { webmcpTools?: { ready: boolean } }).webmcpTools?.ready === true,
    null,
    { timeout: 45_000 },
  );
  return page;
}

type Page = Awaited<ReturnType<typeof openApp>>;

const callTool = (page: Page, name: string, args: object) =>
  page.evaluate(
    async ([name, args]) => {
      const mc = document.modelContext!;
      const tool = (await mc.getTools()).find((t) => t.name === name)!;
      const out = JSON.parse(await mc.executeTool(tool, args as object));
      return { isError: !!out.isError, data: JSON.parse(out.content[0].text) };
    },
    [name, args] as const,
  );

describe('WebMCP on the real page', () => {
  it('registers six tools, and set_settings gives the same run as the URL', async (ctx) => {
    if (!browser) ctx.skip(why);
    const page = await openApp();
    const names = await page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());
    expect(names).toEqual([
      'find_feasible',
      'get_results',
      'get_settings',
      'get_state_at',
      'load_url',
      'set_settings',
      'show',
      'simulate',
    ]);
    const set = await callTool(page, 'set_settings', { settings: { mass: 1600, apexX: -6 } });
    expect(set.isError).toBe(false);
    expect(new URL(set.data.url).search).toBe('?apexX=-6&mass=1600');
    const fromUrl = await openApp('?apexX=-6&mass=1600');
    const viaUrl = await callTool(fromUrl, 'get_results', {});
    expect(set.data.results).toEqual(viaUrl.data.results);
    expect(viaUrl.data.results.incidents.map((i: { hits?: string }) => i.hits)).toContain('Model 3');
    // A what-if leaves the page as it is.
    const before = await callTool(page, 'get_results', {});
    await callTool(page, 'simulate', { settings: { mass: 2900 } });
    expect((await callTool(page, 'get_results', {})).data).toEqual(before.data);
  }, 120_000);

  it('does what docs/webmcp.md says: its console snippet as written, and its worked examples', async (ctx) => {
    if (!browser) ctx.skip(why);
    const page = await openApp();
    // The guide's console snippet, verbatim, run like the console runs it (top-level await).
    const snippet = guide.match(/^```js\n([\s\S]*?)\n```$/m)![1];
    const printed: string[] = [];
    page.on('console', (m) => printed.push(m.text()));
    await page.evaluate(`(async () => {\n${snippet}\n})()`);
    // (Other messages, e.g. the dev server's, may come first.)
    const line = () => printed.find((m) => /^(true|false) /.test(m));
    await expect.poll(line).toBeTruthy();
    // (The console shortens a long array entry in its middle.)
    expect(line()).toMatch(/^true false \[Over rated force: the controller asked RL for more/);
    expect(line()).toMatch(/\/\?mass=3000$/);
    // The answers the guide gives.
    const valid = async (settings: object) => (await callTool(page, 'simulate', { settings })).data.results.valid;
    expect(await valid({ mass: 2950 })).toBe(true);
    expect(await valid({ mass: 3000 })).toBe(false);
    expect(await valid({ mass: 3000, liftThrusterMax: 34000 })).toBe(true);
    const edge = (await callTool(page, 'find_feasible', { vary: ['apexHeight'] })).data.edges[0];
    expect([edge.below, edge.above]).toEqual([7.47, 8.86]);
    expect(await valid({ apexHeight: 8.86 })).toBe(true);
  }, 180_000);
});
