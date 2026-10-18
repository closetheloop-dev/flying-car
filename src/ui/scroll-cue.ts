/**
 * A row that scrolls sideways (the camera buttons, the charts on narrow screens) says
 * there is more: `data-more-left` / `data-more-right` are set while there is more to see
 * that way (style.css fades that edge), and `onChange` hears the same.
 */
export function scrollCue(el: HTMLElement, onChange?: (left: boolean, right: boolean) => void): () => void {
  const update = () => {
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    el.toggleAttribute('data-more-left', left);
    el.toggleAttribute('data-more-right', right);
    onChange?.(left, right);
  };
  el.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(el);
  update();
  return update;
}
