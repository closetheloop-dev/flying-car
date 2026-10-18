import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pages } from './vite-pages';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The pages' shared parts and Markdown, filled in as they are served or built.
  plugins: [pages()],
  build: {
    // The licenses of every bundled dependency (three.js, lil-gui, the fonts, …), served
    // with the site as /licenses.md, as their licenses ask of copies.
    license: { fileName: 'licenses.md' },
    // The simulation, and the reading pages (served at /about/, /guide/, /webmcp/ and /privacy/).
    rolldownOptions: {
      input: {
        main: page('./index.html'),
        about: page('./about/index.html'),
        guide: page('./guide/index.html'),
        webmcp: page('./webmcp/index.html'),
        privacy: page('./privacy/index.html'),
      },
    },
  },
});
