// The reading pages (/about/, /guide/, /webmcp/, /privacy/): the site's fonts and look, and the
// top bar's ☰ menu on a phone.
import '@fontsource-variable/inter';
import '@fontsource/rajdhani/latin-700.css';
import './page.css';
import { scrollCue } from './ui/scroll-cue';
import { wireSiteMenu } from './ui/site-menu';

wireSiteMenu();
// The Guide's contents row scrolls sideways on a phone: it fades on the side with more.
const toc = document.querySelector<HTMLElement>('.toc-links');
if (toc) scrollCue(toc);
