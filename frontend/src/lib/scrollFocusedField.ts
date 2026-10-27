export function scrollFocusedField(
  field: HTMLElement,
  viewportTop: number,
  viewportHeight: number,
  padding = 12,
) {
  const viewportBottom = viewportTop + viewportHeight;
  for (
    let parent = field.parentElement;
    parent && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement
  ) {
    if (
      !/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) ||
      parent.scrollHeight <= parent.clientHeight
    )
      continue;

    const containerTop = parent.getBoundingClientRect().top + parent.clientTop;
    let top = Math.max(viewportTop, containerTop) + padding;
    let bottom =
      Math.min(viewportBottom, containerTop + parent.clientHeight) - padding;
    if (bottom <= top) {
      // Reveal the field inside an offscreen container first. Its outer
      // scrollable ancestors can then bring both into the visual viewport.
      top = containerTop + padding;
      bottom = containerTop + parent.clientHeight - padding;
    }
    if (bottom <= top) continue;

    const bounds = field.getBoundingClientRect();
    let delta = 0;
    if (bounds.height > bottom - top) {
      // A textarea taller than the visible area cannot fit. Preserve its
      // visible portion instead of chasing its bottom and hiding the cursor.
      if (bounds.top >= bottom) delta = bounds.top - top;
      else if (bounds.bottom <= top) delta = bounds.bottom - bottom;
    } else if (bounds.top < top) {
      delta = bounds.top - top;
    } else if (bounds.bottom > bottom) {
      delta = bounds.bottom - bottom;
    }

    if (delta) {
      parent.scrollTop = Math.max(
        0,
        Math.min(
          parent.scrollTop + delta,
          parent.scrollHeight - parent.clientHeight,
        ),
      );
    }
  }
}
