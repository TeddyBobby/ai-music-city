import { create } from "zustand";
import { usePlayer } from "./player";

interface PlayerOverlayState {
  jobId: string | null;
  opened: boolean;
  initialView: "cover" | "reviews";
  open: (id?: string, view?: "cover" | "reviews") => void;
  close: () => void;
}

// The listening view is an overlay: opening it never replaces the current page.
export const usePlayerOverlay = create<PlayerOverlayState>((set) => ({
  jobId: null,
  opened: false,
  initialView: "cover",
  open: (id, view = "cover") => {
    const jobId = id || usePlayer.getState().current?.id;
    if (jobId) set({ jobId, opened: true, initialView: view });
  },
  // Keep the track until the exit animation finishes.
  close: () => set({ opened: false }),
}));
