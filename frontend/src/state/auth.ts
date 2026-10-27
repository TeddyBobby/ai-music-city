import { create } from "zustand";
import { api } from "../lib/api";
import { accountChangeKey, adoptAccount, leaveAccount } from "../lib/accountBoundary";

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
  /** 登录页软切换：游客 → 用户，无需整页重载 */
  setAuthUser: (user: AuthUser) => void;
  /** 软切换后通知各业务 store 重新拉取登录态数据 */
  refreshAfterLogin: () => void;
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
  setAuthUser: (user: AuthUser) => {
    set({ user, loading: false, setupRequired: false, error: "" });
  },
  refreshAfterLogin: () => {
    // 广播账号纪元变化：让游客会话的在途请求作废、各业务 store 重新拉数据。
    try {
      localStorage.setItem(
        accountChangeKey,
        JSON.stringify({ user: get().user?.id || null, nonce: `${Date.now()}-${Math.random()}` }),
      );
    } catch {}
    window.dispatchEvent(new Event("storage"));
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
