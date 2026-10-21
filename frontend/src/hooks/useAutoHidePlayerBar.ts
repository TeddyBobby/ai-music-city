import { useCallback, useEffect, useRef, useState } from "react";

type ScrollIntent = {
  element: HTMLElement;
  direction: number;
  top: number;
  distance: number;
  until: number;
};

type Options = { locked: boolean; resetKey: string };

const IDLE_MS = 800;
const HIDE_DISTANCE = 4;
const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const OVERLAY =
  '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], .mantine-Popover-dropdown, .mantine-Modal-root, .mantine-Drawer-root';

/** Hide only after a vertical scroll caused by a recent gesture in the work area. */
export function useAutoHidePlayerBar({ locked, resetKey }: Options) {
  const [hidden, setHidden] = useState(false);
  const intent = useRef<ScrollIntent | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    intent.current = null;
    setHidden(false);
  }, []);

  useEffect(() => {
    reveal();
    const main = document.getElementById("main-content");
    if (!main || locked) return;

    let scrollbarDrag: HTMLElement | null = null;
    let touch: { id: number; x: number; y: number; target: Element } | null =
      null;

    const permitted = (target: EventTarget | null): target is Element =>
      target instanceof Element &&
      main.contains(target) &&
      !target.closest(`${EDITABLE}, ${OVERLAY}`);

    const scroller = (target: Element, direction: number) => {
      let element: HTMLElement | null =
        target instanceof HTMLElement ? target : target.parentElement;
      while (element && main.contains(element)) {
        const max = element.scrollHeight - element.clientHeight;
        if (
          max > 1 &&
          /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY) &&
          (direction > 0
            ? element.scrollTop < max - 0.5
            : element.scrollTop > 0.5)
        )
          return element;
        if (element === main) break;
        element = element.parentElement;
      }
      return null;
    };

    const arm = (target: Element, direction: number, duration: number) => {
      const element = scroller(target, direction);
      if (!element) {
        intent.current = null;
        return;
      }
      const prior = intent.current;
      const sameGesture =
        prior?.element === element &&
        prior.direction === direction &&
        prior.until >= performance.now();
      intent.current = {
        element,
        direction,
        // A compositor may deliver several wheel events before one scroll event.
        top: sameGesture ? prior.top : element.scrollTop,
        distance: sameGesture ? prior.distance : 0,
        until: performance.now() + duration,
      };
    };

    const onWheel = (event: WheelEvent) => {
      if (
        !permitted(event.target) ||
        Math.abs(event.deltaY) < 0.5 ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      )
        return;
      // Wheel inertia produces its own events. A short gate excludes later model-driven scrolls.
      arm(event.target, Math.sign(event.deltaY), 400);
    };

    const onScroll = (event: Event) => {
      const active = intent.current;
      if (
        !active ||
        event.target !== active.element ||
        performance.now() > active.until
      )
        return;
      const delta = active.element.scrollTop - active.top;
      active.top = active.element.scrollTop;
      if (
        Math.abs(delta) < 0.5 ||
        (active.direction !== 0 && Math.sign(delta) !== active.direction)
      )
        return;
      active.distance = delta < 0 ? 0 : active.distance + delta;
      if (delta < 0) setHidden(false);
      else if (active.distance >= HIDE_DISTANCE) setHidden(true);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(reveal, IDLE_MS);
    };

    const onScrollbarDown = (event: MouseEvent | PointerEvent) => {
      if (
        event.button !== 0 ||
        ("pointerType" in event && event.pointerType === "touch") ||
        !permitted(event.target)
      )
        return;
      let element =
        event.target instanceof HTMLElement
          ? event.target
          : event.target.parentElement;
      while (element && main.contains(element)) {
        const style = getComputedStyle(element);
        if (
          element.scrollHeight > element.clientHeight + 1 &&
          /^(auto|scroll|overlay)$/.test(style.overflowY)
        ) {
          const rect = element.getBoundingClientRect();
          const borderLeft = parseFloat(style.borderLeftWidth) || 0;
          const borderRight = parseFloat(style.borderRightWidth) || 0;
          const gutter =
            element.offsetWidth -
            element.clientWidth -
            borderLeft -
            borderRight;
          const leftSide = style.direction === "rtl";
          // Overlay scrollbars occupy the last few pixels of the scrolling viewport.
          const width = Math.max(gutter, 10);
          const onTrack = leftSide
            ? event.clientX >= rect.left && event.clientX <= rect.left + width
            : event.clientX <= rect.right &&
              event.clientX >= rect.right - width;
          if (
            onTrack &&
            event.clientY >= rect.top + element.clientTop &&
            event.clientY < rect.top + element.clientTop + element.clientHeight
          ) {
            scrollbarDrag = element;
            intent.current = {
              element,
              direction: 0,
              top: element.scrollTop,
              distance: 0,
              until: performance.now() + 1000,
            };
            return;
          }
        }
        if (element === main) break;
        element = element.parentElement;
      }
    };
    const onScrollbarMove = (event: MouseEvent | PointerEvent) => {
      if (!scrollbarDrag) return;
      if (!(event.buttons & 1)) {
        onScrollbarUp();
        return;
      }
      if (intent.current?.element === scrollbarDrag)
        intent.current.until = performance.now() + 1000;
      else
        intent.current = {
          element: scrollbarDrag,
          direction: 0,
          top: scrollbarDrag.scrollTop,
          distance: 0,
          until: performance.now() + 1000,
        };
    };
    const onScrollbarUp = () => {
      if (scrollbarDrag && intent.current?.element === scrollbarDrag)
        intent.current.until = performance.now() + 180;
      scrollbarDrag = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!permitted(event.target) || event.touches.length !== 1) {
        touch = null;
        return;
      }
      const point = event.touches[0];
      touch = {
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        target: event.target,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const point = Array.from(event.touches).find(
        (item) => item.identifier === touch!.id,
      );
      if (!point) return;
      const dy = touch.y - point.clientY,
        dx = touch.x - point.clientX;
      touch.x = point.clientX;
      touch.y = point.clientY;
      if (Math.abs(dy) < 0.5 || Math.abs(dy) <= Math.abs(dx)) return;
      arm(touch.target, Math.sign(dy), 180);
    };
    const onTouchEnd = () => {
      // Allow a bounded native momentum tail, without turning programmatic scrolling into intent.
      if (touch && intent.current)
        intent.current.until = performance.now() + 700;
      touch = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        reveal();
        return;
      }
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const direction =
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === "End"
          ? 1
          : event.key === "ArrowUp" ||
              event.key === "PageUp" ||
              event.key === "Home"
            ? -1
            : event.key === " "
              ? event.shiftKey
                ? -1
                : 1
              : 0;
      if (!direction) return;
      const target =
        event.target === document.body ||
        event.target === document.documentElement
          ? main
          : event.target;
      if (permitted(target)) arm(target, direction, 450);
    };

    main.addEventListener("pointerdown", onScrollbarDown, true);
    main.addEventListener("mousedown", onScrollbarDown, true);
    document.addEventListener("pointermove", onScrollbarMove, true);
    document.addEventListener("mousemove", onScrollbarMove, true);
    document.addEventListener("pointerup", onScrollbarUp, true);
    document.addEventListener("mouseup", onScrollbarUp, true);
    document.addEventListener("pointercancel", onScrollbarUp, true);
    main.addEventListener("wheel", onWheel, { capture: true, passive: true });
    main.addEventListener("scroll", onScroll, { capture: true, passive: true });
    main.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    main.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    });
    main.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: true,
    });
    main.addEventListener("touchcancel", onTouchEnd, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      main.removeEventListener("pointerdown", onScrollbarDown, true);
      main.removeEventListener("mousedown", onScrollbarDown, true);
      document.removeEventListener("pointermove", onScrollbarMove, true);
      document.removeEventListener("mousemove", onScrollbarMove, true);
      document.removeEventListener("pointerup", onScrollbarUp, true);
      document.removeEventListener("mouseup", onScrollbarUp, true);
      document.removeEventListener("pointercancel", onScrollbarUp, true);
      main.removeEventListener("wheel", onWheel, true);
      main.removeEventListener("scroll", onScroll, true);
      main.removeEventListener("touchstart", onTouchStart, true);
      main.removeEventListener("touchmove", onTouchMove, true);
      main.removeEventListener("touchend", onTouchEnd, true);
      main.removeEventListener("touchcancel", onTouchEnd, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      idleTimer.current = null;
      intent.current = null;
      touch = null;
      scrollbarDrag = null;
    };
  }, [locked, resetKey, reveal]);

  return { hidden: locked ? false : hidden, reveal };
}
