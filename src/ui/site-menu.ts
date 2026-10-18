/**
 * The site's links folded under ☰ on a phone (site-nav.css), in the simulation's top bar and
 * the reading pages' header alike: ☰ opens and closes them; choosing one, a tap elsewhere or
 * Esc closes them (focus back on ☰).
 */
/** Where focus goes back to after something opened from `from` closes: `from` if it's still
 * shown, else ☰ (it was in the folded menu). */
export function returnFocus(from: HTMLElement) {
  (from.getClientRects().length ? from : document.getElementById('menu-btn'))?.focus();
}

export function wireSiteMenu() {
  const menuBtn = document.getElementById('menu-btn');
  const siteMenu = document.getElementById('site-menu');
  const nav = document.querySelector<HTMLElement>('.top-actions');
  if (!menuBtn || !siteMenu || !nav) return;
  const isOpen = () => siteMenu.classList.contains('open');
  const setOpen = (open: boolean) => {
    siteMenu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) siteMenu.querySelector<HTMLElement>('button, a')?.focus();
  };
  menuBtn.onclick = () => setOpen(!isOpen());
  // (After the item does its thing.)
  siteMenu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, a')) setOpen(false);
  });
  // (Anything but the menu and ☰, the bar's other buttons included: e.g. Reset's dialog
  // shouldn't open over a menu left open.)
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (isOpen() && !siteMenu.contains(t) && !menuBtn.contains(t)) setOpen(false);
  });
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation(); // (not also closing whatever else Esc closes, e.g. the Lab)
    setOpen(false);
    menuBtn.focus();
  });
}
