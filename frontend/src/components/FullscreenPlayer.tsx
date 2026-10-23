import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Modal } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { usePlayerOverlay } from "../state/playerOverlay";
import { usePlayer } from "../state/player";
import { PlayerPage } from "../pages/PlayerPage";

function playerOrigin() {
  const button = document.querySelector<HTMLElement>(
    ".player-dock .dock-expand",
  );
  const rect = button?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return `${Math.min(window.innerWidth, Math.max(0, x))}px ${Math.min(window.innerHeight, Math.max(0, y))}px`;
  }
  // Compact layouts hide the expand button; anchor to the fixed playback bar.
  const dock = document.querySelector<HTMLElement>(".player-dock");
  const dockRect = dock?.getBoundingClientRect();
  if (dock && dockRect && dockRect.height > 0) {
    return `${Math.max(0, window.innerWidth - 24)}px ${Math.min(window.innerHeight, Math.max(0, dockRect.top + dockRect.height / 2))}px`;
  }
  return `${Math.max(0, window.innerWidth - 24)}px ${Math.max(0, window.innerHeight - 32)}px`;
}

export function FullscreenPlayer() {
  const { opened, jobId, initialView, close, open } = usePlayerOverlay();
  const currentId = usePlayer((s) => s.current?.id);
  const previousId = useRef(currentId);
  const reducedMotion = useReducedMotion();
  const [childDialog, setChildDialog] = useState(false);
  const [entered, setEntered] = useState(false);
  const [origin, setOrigin] = useState("100% 100%");

  // Measure before opening, then retain that point throughout the exit animation.
  // Only a resize while fully open needs a fresh measurement.
  useLayoutEffect(() => {
    if (!opened) return;
    const updateOrigin = () => setOrigin(playerOrigin());
    updateOrigin();
    window.addEventListener("resize", updateOrigin);
    return () => window.removeEventListener("resize", updateOrigin);
  }, [opened]);

  const listeningTransition = {
    in: {
      opacity: 1,
      transform: "translateZ(0) scale(1)",
      borderRadius: "0px",
    },
    out: {
      opacity: 0,
      transform: "translateZ(0) scale(.04)",
      borderRadius: "32px",
    },
    common: { transformOrigin: origin },
    transitionProperty: "transform, opacity, border-radius",
  };

  // Follow the queue when the visible song finishes or the user skips a track.
  useEffect(() => {
    // Keep the edited song stable until its child dialog closes.
    if (childDialog) return;
    if (
      opened &&
      currentId &&
      previousId.current === jobId &&
      currentId !== jobId
    )
      open(currentId);
    previousId.current = currentId;
  }, [currentId, opened, jobId, open, childDialog]);
  useEffect(() => {
    if (!opened) {
      setChildDialog(false);
      setEntered(false);
    }
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={close}
      onEnterTransitionEnd={() => setEntered(true)}
      fullScreen
      withCloseButton={false}
      withOverlay={false}
      returnFocus
      closeOnEscape={!childDialog}
      closeOnClickOutside={false}
      trapFocus={!childDialog}
      lockScroll
      padding={0}
      zIndex={300}
      title="全屏播放器"
      styles={{
        header: {
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          minHeight: 0,
          overflow: "hidden",
          clipPath: "inset(50%)",
        },
      }}
      classNames={{
        root: "fullscreen-player-root",
        inner: "fullscreen-player-inner",
        content: "fullscreen-player-shell",
        body: "fullscreen-player-body",
      }}
      transitionProps={{
        transition: listeningTransition,
        duration: reducedMotion ? 0 : 420,
        exitDuration: reducedMotion ? 0 : 320,
        timingFunction: "cubic-bezier(.22, .8, .22, 1)",
      }}
    >
      {jobId && (
        <PlayerPage
          jobId={jobId}
          initialView={initialView}
          entered={entered}
          onClose={close}
          onDialogChange={setChildDialog}
        />
      )}
    </Modal>
  );
}
