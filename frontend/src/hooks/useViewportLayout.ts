import { useEffect, useState } from "react";

export type ViewportLayout = {
  keyboardOpen: boolean;
  viewportHeight: number;
  keyboardInset: number;
};

function hasTextFocus() {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled;
  }
  if (element instanceof HTMLInputElement) {
    return (
      !element.readOnly &&
      !element.disabled &&
      ![
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].includes(element.type)
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Measure the browser viewport, never the shell whose height these values drive. */
export function useViewportLayout(): ViewportLayout {
  const [layout, setLayout] = useState<ViewportLayout>(() => ({
    keyboardOpen: false,
    viewportHeight: typeof window === "undefined" ? 0 : window.innerHeight,
    keyboardInset: 0,
  }));

  useEffect(() => {
    const viewport = window.visualViewport;
    const mobile = window.matchMedia("(max-width: 760px), (pointer: coarse)");
    let restingHeight = window.innerHeight;
    let layoutWidth = window.innerWidth;
    const restingHeights = new Map([[layoutWidth, restingHeight]]);
    let keyboardWasOpen = false;
    let frame = 0;
    let focusOutTimer = 0;
    let focused = hasTextFocus();

    const measure = () => {
      frame = 0;
      const textFocused = hasTextFocus();
      const atNaturalScale = !viewport || Math.abs(viewport.scale - 1) < 0.05;
      const visualHeight = atNaturalScale
        ? Math.round(viewport?.height || window.innerHeight)
        : window.innerHeight;

      // orientationchange can precede the new viewport dimensions. Rebase only
      // once the layout width actually changes, not at the event itself.
      if (atNaturalScale && window.innerWidth !== layoutWidth) {
        const turnedLandscape = window.innerWidth > layoutWidth;
        layoutWidth = window.innerWidth;
        const rememberedHeight = restingHeights.get(layoutWidth);
        if (rememberedHeight !== undefined) {
          restingHeight = rememberedHeight;
        } else if (textFocused && keyboardWasOpen && mobile.matches) {
          // Android may already have resized innerHeight for the keyboard.
          // For a previously unseen orientation, the available screen bounds
          // provide a baseline until we can observe an unfocused viewport.
          const sides = [window.screen.availWidth, window.screen.availHeight];
          const availableHeight = sides.every((side) => side > 0)
            ? turnedLandscape
              ? Math.min(...sides)
              : Math.max(...sides)
            : window.innerHeight;
          restingHeight = Math.max(window.innerHeight, availableHeight);
        } else {
          restingHeight = window.innerHeight;
        }
      }

      // Retain the pre-focus size on browsers that resize innerHeight for the
      // keyboard. Pinch zoom must never be interpreted as a keyboard opening.
      if (!textFocused && !focused && atNaturalScale) {
        restingHeight = window.innerHeight;
        restingHeights.set(layoutWidth, restingHeight);
      }
      const inset = Math.max(0, restingHeight - visualHeight);
      const keyboardOpen =
        mobile.matches &&
        textFocused &&
        atNaturalScale &&
        inset > Math.max(120, restingHeight * 0.16);
      focused = textFocused;
      // Pinching can temporarily reduce the visual viewport while the keyboard
      // is still present. Preserve this only for rotation-baseline recovery.
      if (atNaturalScale) keyboardWasOpen = keyboardOpen;
      const next = {
        keyboardOpen,
        viewportHeight: visualHeight,
        keyboardInset: keyboardOpen ? inset : 0,
      };
      setLayout((previous) =>
        previous.keyboardOpen === next.keyboardOpen &&
        previous.viewportHeight === next.viewportHeight &&
        previous.keyboardInset === next.keyboardInset
          ? previous
          : next,
      );
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const onFocusIn = () => {
      window.clearTimeout(focusOutTimer);
      if (!focused) restingHeight = Math.max(restingHeight, window.innerHeight);
      schedule();
    };
    const onFocusOut = () => {
      // Let focus settle before deciding whether the user left the form or
      // simply moved between its fields.
      window.clearTimeout(focusOutTimer);
      focusOutTimer = window.setTimeout(schedule, 80);
    };

    measure();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    mobile.addEventListener("change", schedule);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(focusOutTimer);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      mobile.removeEventListener("change", schedule);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return layout;
}
