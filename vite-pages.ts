import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { renderPage } from './src/build/render-pages';

const root = fileURLToPath(new URL('.', import.meta.url));
const read = (path: string) => readFileSync(root + path, 'utf8');

/**
 * Fills in the pages' shared parts (src/partials/) and Markdown (docs/) as Vite serves or
 * builds them; see src/build/render-pages.ts. Editing a partial or a doc reloads the page.
 */
export function pages(): Plugin {
  return {
    name: 'flyingcar-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => renderPage(html, ctx.path, read),
    },
    handleHotUpdate({ file, server }) {
      if (/\/(src\/partials|docs)\//.test(file)) server.ws.send({ type: 'full-reload' });
    },
  };
}
