import { create } from "zustand";
import { api } from "../lib/api";
import { adoptAccount, leaveAccount } from "../lib/accountBoundary";

export interface AuthUser {
  id: string;
  email: string;
  is_admin: boolean;
  legacy_owner: boolean;
}
interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  setupRequired: boolean;
  error: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}
let pending: Promise<void> | null = null;
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  setupRequired: false,
  error: "",
  refresh: () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const data = await api.get("/api/auth/status");
        const user: AuthUser | null = data.user ?? null;
        if (!get().loading && get().user?.id !== user?.id) {
          leaveAccount(user?.id || null);
          return;
        }
        // Bind storage before Shell mounts and restores personal drafts.
        if (adoptAccount(user?.id || null) && user) {
          leaveAccount(user.id, false);
          return;
        }
        set({
          user,
          loading: false,
          setupRequired: !!data.setup_required,
          error: "",
        });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "登录状态读取失败，请重试。",
          loading: false,
        });
      } finally {
        pending = null;
      }
    })();
    return pending;
  },
  logout: async () => {
    // A failed logout must not pretend the HttpOnly session was revoked.
    // 先落好登出后的落点（登录页），再请求登出并整页重载——避免重载后短暂闪回需登录的页面。
    try {
      window.location.hash = "#/login";
    } catch {}
    await api.post("/api/auth/logout", {});
    leaveAccount(null);
  },
}));
