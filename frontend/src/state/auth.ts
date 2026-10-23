import { create } from "zustand";
import { api } from "../lib/api";

interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  refresh: async () => {
    try {
      const data = await api.get("/api/auth/status");
      set({ user: data.user ?? null, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  logout: async () => {
    try {
      await api.post("/api/auth/logout", {});
    } catch {
      /* ignore */
    }
    set({ user: null });
  },
}));
