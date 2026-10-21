import { create } from "zustand";
import { api } from "../lib/api";
type Toast = { id: number; text: string; kind: string };
interface State {
  status: any;
  settings: any;
  toasts: Toast[];
  refresh: () => Promise<void>;
  toast: (message: string, kind?: string) => void;
  dismiss: (id: number) => void;
}
let serial = 0;
export const useApp = create<State>((set, get) => ({
  status: null,
  settings: null,
  toasts: [],
  refresh: async () => {
    const [s, c] = await Promise.allSettled([api.status(), api.settings()]);
    set({
      status: s.status === "fulfilled" ? s.value : null,
      ...(c.status === "fulfilled" ? { settings: c.value } : {}),
    });
  },
  toast: (text, kind = "info") => {
    const id = ++serial;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
    window.setTimeout(() => get().dismiss(id), 6500);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
