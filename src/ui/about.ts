import { aboutHtml } from './about-text';

export { BLOG_URL, FOOTAGE_URL, REPO_URL, aboutHtml } from './about-text';

/** The About dialog: the About text (about-text.ts) under its title, with a close button. */
export function buildAbout(dialog: HTMLDialogElement) {
  dialog.innerHTML = `<div class="about-inner">
    <button class="icon-btn close" aria-label="Close">✕</button>
    <h2 id="about-title">Flying Car</h2>
    ${aboutHtml()}
  </div>`;
  dialog.querySelector<HTMLButtonElement>('.close')!.onclick = () => dialog.close();
  // A click on the backdrop (outside the content) closes it too, but only one that starts
  // there, not a text selection dragged out of the content.
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) dialog.close();
  });
}
