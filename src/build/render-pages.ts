/**
 * Build-time assembly of the HTML pages (used by the Vite plugin in vite-pages.ts; never
 * shipped to the browser). In a page:
 *
 *   <!-- include: src/partials/page-header.html -->   is replaced by that file;
 *   <!-- markdown: docs/webmcp.md -->                 by that file rendered to HTML;
 *   <!-- settings-reference -->                       by every setting explained (/guide/);
 *   <!-- about -->                                    by the About text (/about/, as in the
 *                                                     simulation's About dialog).
 *
 * The site's nav (src/partials/site-links.html, in every page's top bar) marks the link to
 * the page itself with aria-current="page". Every other HTML comment is left out of the
 * built page.
 */
import { marked } from 'marked';
import { aboutHtml } from '../ui/about-text';
import { renderSettingsReference } from './settings-reference';

/** Reads a file of the repository by its path from the root. */
export type ReadFile = (path: string) => string;

/** Markdown (GitHub flavor) to the pages' HTML. */
export function renderMarkdown(md: string): string {
  // Lines only for readers of the file itself (e.g. "also on the web at ...").
  const source = md.replace(/<!--\s*web:skip\s*-->[\s\S]*?<!--\s*\/web:skip\s*-->\n?/g, '');
  return (
    (marked.parse(source, { async: false, gfm: true }) as string)
      // Wide tables scroll inside their own box on narrow screens.
      .replace(/<table>/g, '<div class="table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>')
      // Links into the site stay on whatever host serves it; others open in a new tab.
      .replace(/href="https:\/\/flyingcar\.pet\//g, 'href="/')
      .replace(/<a href="(https?:[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener"')
  );
}

/** A page's HTML with its includes filled in. `path` is the page's URL path, e.g. /webmcp/. */
export function renderPage(html: string, path: string, read: ReadFile): string {
  let out = html;
  // (Partials may include partials, e.g. the page header includes the logo.)
  for (let depth = 0; depth < 4 && /<!--\s*include:/.test(out); depth++) {
    out = out.replace(/<!--\s*include:\s*(\S+)\s*-->/g, (_, file: string) => read(file).trimEnd());
  }
  out = out.replace(/<!--\s*markdown:\s*(\S+)\s*-->/g, (_, file: string) => renderMarkdown(read(file)));
  out = out.replace(/<!--\s*settings-reference\s*-->/gi, () => renderSettingsReference());
  // (h2 sections under the page's h1; the dialog has them as h3 under its h2.)
  out = out.replace(/<!--\s*about\s*-->/gi, () => aboutHtml(2));
  const here = path.replace(/index\.html$/, '');
  out = out.replace(/<nav class="top-actions"[\s\S]*?<\/nav>/, (nav) =>
    nav.replace(`href="${here}"`, `href="${here}" aria-current="page"`),
  );
  // (Any case: a marker written <!-- About --> fails here rather than shipping as a comment.)
  const left = out.match(/<!--\s*(?:(?:include|markdown):[^>]*|settings-reference|about)\s*-->/i);
  if (left) throw new Error(`${path}: unresolved ${left[0]}`);
  // The sources' comments are notes for whoever edits them, not for the visitors.
  // (A comment alone on its line(s) takes the line with it; one that shares its line, just itself.)
  return out.replace(/^[ \t]*<!--(?:(?!-->)[\s\S])*-->[ \t]*\n/gm, '').replace(/<!--[\s\S]*?-->/g, '');
}
