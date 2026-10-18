import { describe, expect, it } from 'vitest';
import guide from '../docs/webmcp.md?raw';
import app from '../index.html?raw';
import privacyPage from '../privacy/index.html?raw';
import readme from '../README.md?raw';
import { renderPage } from '../src/build/render-pages';
import { SETTINGS } from '../src/physics/settings';
import { BLOG_URL, REPO_URL, aboutHtml } from '../src/ui/about';
import { contactImage } from '../src/ui/contact';
import aboutPage from '../about/index.html?raw';
import guidePage from '../guide/index.html?raw';
import webmcpPage from '../webmcp/index.html?raw';

// The files the pages include, by their path from the repository root (as the plugin reads them).
const parts = import.meta.glob<string>(['../src/partials/*.html', '../docs/*.md'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
// Every source file the site is built from (and these tests), as text.
const code = import.meta.glob<string>(['../src/**/*.{ts,css,html}', '../*.{html,ts,json}', '../tests/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string) => {
  const text = parts[`../${path}`];
  if (text === undefined) throw new Error(`no such file: ${path}`);
  return text;
};
const rendered = {
  '/': renderPage(app, '/index.html', read),
  '/about/': renderPage(aboutPage, '/about/index.html', read),
  '/guide/': renderPage(guidePage, '/guide/index.html', read),
  '/webmcp/': renderPage(webmcpPage, '/webmcp/index.html', read),
  '/privacy/': renderPage(privacyPage, '/privacy/index.html', read),
};

/** The fenced code blocks of a Markdown file, as [language, code]. */
const mdBlocks = (md: string) => [...md.matchAll(/^```(\w+)\n([\s\S]*?)\n```$/gm)].map((m) => [m[1], m[2]]);
/** The <pre><code> blocks of an HTML page, as [language, code], with entities decoded. */
const htmlBlocks = (html: string) =>
  [...html.matchAll(/<pre><code class="language-(\w+)">([\s\S]*?)\n?<\/code><\/pre>/g)].map((m) => [
    m[1],
    m[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&'),
  ]);

describe('the pages, as built', () => {
  it('render docs/webmcp.md into /webmcp/, code and all', () => {
    const page = rendered['/webmcp/'];
    expect(mdBlocks(guide).length).toBeGreaterThan(0);
    expect(htmlBlocks(page)).toEqual(mdBlocks(guide));
    expect(page).toContain('<h1>Using flyingcar.pet with an AI agent (WebMCP)</h1>');
    expect(page).toContain('<div class="table-wrap"><table>');
    expect(page).not.toContain('formatted for the web'); // a line only for readers of the file
    expect(page).toContain('href="/?mass=2950"'); // links into the site stay on its host
    expect(page).toMatch(/<a href="https:\/\/webmachinelearning[^"]*" target="_blank" rel="noopener">/);
  });

  it('explain every setting in the Guide (/guide/), each with an anchor and a drawing', () => {
    const page = rendered['/guide/'];
    expect(page).not.toContain('<!-- settings-reference');
    const cards = [...page.matchAll(/<article class="setting" id="(\w+)">([\s\S]*?)<\/article>/g)];
    expect(cards.map((m) => m[1]).sort()).toEqual(SETTINGS.map((s) => s.key).sort());
    for (const [, key, card] of cards) {
      expect(card, key).toContain('<svg class="diagram"');
      expect(card, key).toContain(`<code>${key}</code>`);
      expect(card, key).toContain(`<a href="/?explore=${key}">`);
    }
    // Each drawing is labeled with its setting (several share a kind of drawing).
    const labels = [...page.matchAll(/<svg class="diagram"[^>]* aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(labels).size).toBe(SETTINGS.length);
    // The arrowheads the drawings use are defined once on the page.
    expect(page.match(/<marker id="arrow-on"/g)).toHaveLength(1);
    for (const [, id] of page.matchAll(/url\(#([\w-]+)\)/g)) expect(page).toContain(`id="${id}"`);
  });

  it('give /about/ the About dialog’s text, contact and Privacy link included', () => {
    const page = rendered['/about/'];
    expect(page).not.toContain('<!-- about');
    expect(page).toContain(aboutHtml(2));
    expect(page).toContain('<h1>About Flying Car</h1>');
    // Its sections a level up from the dialog's: h2 under the page's h1.
    const main = page.match(/<main[\s\S]*<\/main>/)![0];
    expect([...main.matchAll(/<h(\d)/g)].map((m) => m[1]).join('')).toMatch(/^12+$/);
    expect(page).toContain('<a href="/">Open the simulation</a>');
    expect(page).toContain('src="/contact.png"');
    expect(page).toContain('<a href="/privacy/">Privacy</a>');
  });

  it('share their header, footer and logo, and mark where you are', () => {
    for (const [path, page] of Object.entries(rendered)) {
      expect(page, path).not.toMatch(/<!--\s*(include|markdown):/);
      expect(page, path).toContain('class="logo-plume"');
    }
    for (const path of ['/about/', '/guide/', '/webmcp/', '/privacy/'] as const) {
      expect(rendered[path]).toContain('<footer class="page-foot">');
    }
    // The pages to read mark themselves in the nav (Privacy is linked from About, not there).
    for (const path of ['/about/', '/guide/', '/webmcp/'] as const) {
      expect(rendered[path]).toContain(`href="${path}" aria-current="page"`);
      expect(rendered[path].match(/aria-current/g)).toHaveLength(1);
    }
    expect(rendered['/privacy/']).not.toContain('aria-current');
  });

  it('leave the sources’ comments out of what visitors get', () => {
    for (const [path, page] of Object.entries(rendered)) {
      expect(page, path).not.toContain('<!--');
      expect(page, path).not.toMatch(/^[ \t]+\n/m); // (nor the lines they stood on)
    }
    // ...and only the comments: what shares a line with one stays.
    const page = '  <!-- a --> <b>keep</b>\n  <!-- one\n  more -->\n<p>x</p> <!-- n -->\n<p>after</p>\n';
    expect(renderPage(page, '/x/', read)).toBe('   <b>keep</b>\n<p>x</p> \n<p>after</p>\n');
  });

  it('give every page the same site links, in the same order, with ☰ for phones', () => {
    const links = (page: string) => {
      const nav = page.match(/<nav class="top-actions"[\s\S]*?<\/nav>/)?.[0] ?? '';
      return [...nav.matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== '/');
    };
    const expected = ['/guide/', '/webmcp/', REPO_URL, BLOG_URL];
    for (const [path, page] of Object.entries(rendered)) {
      // (The pages to read link About; the simulation has its About dialog's button.)
      expect(links(page), path).toEqual(path === '/' ? expected : ['/about/', ...expected]);
      expect(page, path).toContain('id="menu-btn"');
    }
  });

  it('link to the one repository', () => {
    for (const [name, text] of Object.entries({ ...rendered, 'docs/webmcp.md': guide, 'README.md': readme })) {
      for (const [url] of text.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g)) {
        expect(url.replace(/\.git$/, ''), name).toBe(REPO_URL);
      }
    }
  });

  it('carry no part of the contact address as text: it is only a picture', () => {
    // (Put together here, so this file doesn't contain it either.)
    const user = ['closetheloop', 'dev'].join('');
    const sources = { ...code, ...rendered, 'docs/webmcp.md': guide, 'README.md': readme, contact: contactImage() };
    expect(Object.keys(code).length).toBeGreaterThan(20);
    for (const [name, text] of Object.entries(sources)) expect(text.toLowerCase().includes(user), name).toBe(false);
    expect(contactImage()).toContain('src="/contact.png"');
    // Only About (the dialog and /about/) has it; the other pages don't.
    for (const path of ['/guide/', '/webmcp/', '/privacy/'] as const) {
      expect(rendered[path], path).not.toContain('contact.png');
    }
  });

  it('link the making-of blog from the pages, at its one address', () => {
    for (const path of ['/about/', '/guide/', '/webmcp/', '/privacy/'] as const) {
      // (The footer's own link: the top bar's alone would pass a check of the whole page.)
      const foot = rendered[path].match(/<footer class="page-foot">[\s\S]*?<\/footer>/)?.[0] ?? '';
      expect(foot, path).toContain(`href="${BLOG_URL}"`);
    }
    expect(readme).toContain(BLOG_URL);
    for (const [name, text] of Object.entries({ ...rendered, 'docs/webmcp.md': guide, 'README.md': readme })) {
      for (const [url] of text.matchAll(/https?:\/\/(?:www\.)?closetheloop\.dev[^\s"'<>)]*/g)) {
        expect(url, name).toBe(BLOG_URL);
      }
    }
  });
});
