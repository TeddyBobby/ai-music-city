// Account changes replace the document so detached requests, route stores and
// media elements cannot survive into the next account's workspace.
const ownerKey = "amc.account.owner";
export const accountChangeKey = "amc.account.change";
const sessionOwnerKey = "amc.account.session";
const cleanup = new Set<() => void>();
let epoch = 0;
let leaving = false;
// Keep the identity that mounted this document. Reading a shared localStorage
// value here would silently adopt another tab's newly authenticated account.
let boundAccountId: string | null = null;

export const accountEpoch = () => epoch;
export function assertAccountEpoch(expected: number) {
  if (expected !== epoch || leaving)
    throw new DOMException("账号已切换，请重新打开页面。", "AbortError");
}

export function registerAccountCleanup(callback: () => void) {
  cleanup.add(callback);
  return () => {
    cleanup.delete(callback);
  };
}

export function clearPersonalStorage(storage: Storage) {
  // Preserve only appearance/volume preferences; drafts and resource IDs are
  // personal even on routes no longer present in the consumer navigation.
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || key === "yue2.theme" || key === "yue2.player.volume") continue;
    if (
      key.startsWith("yue2.") ||
      key.startsWith("music.") ||
      key === "yue2-assistant-draft" ||
      key === "tingjian.home-draft"
    )
      keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

function clean() {
  epoch++;
  cleanup.forEach((callback) => {
    try {
      callback();
    } catch {}
  });
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      clearPersonalStorage(window[name]);
    } catch {}
  }
}

/** Bind persisted drafts before any private route mounts. */
export function adoptAccount(userId: string | null) {
  boundAccountId = userId;
  const owner = userId || "";
  try {
    const changed =
      localStorage.getItem(ownerKey) !== owner ||
      sessionStorage.getItem(sessionOwnerKey) !== owner;
    if (changed) clean();
    localStorage.setItem(ownerKey, owner);
    sessionStorage.setItem(sessionOwnerKey, owner);
    return changed;
  } catch {
    // Storage may be disabled. Account transitions still explicitly reload.
    return false;
  }
}

export function leaveAccount(userId: string | null, announce = true) {
  if (leaving) return;
  leaving = true;
  boundAccountId = null;
  clean();
  try {
    localStorage.setItem(ownerKey, userId || "");
    sessionStorage.setItem(sessionOwnerKey, userId || "");
    if (announce)
      localStorage.setItem(
        accountChangeKey,
        JSON.stringify({
          user: userId,
          // This is an event discriminator, not a credential. It also works
          // over local-network HTTP, where randomUUID may be unavailable.
          nonce: `${Date.now()}-${Math.random()}`,
        }),
      );
  } catch {}
  window.location.reload();
}

export function handleUnauthorized(status: number, path: string) {
  if (status !== 401 || path.startsWith("/api/auth/")) return;
  // 游客（从未登录）收到 401 是预期：不整页刷新，让调用方自己引导去登录。
  // 只有"已登录用户的会话失效"才需要清空本地状态并重载。
  const wasBound = boundAccountId !== null;
  if (wasBound) leaveAccount(null);
}

export async function accountFetch(path: string, init?: RequestInit) {
  const expected = accountEpoch();
  assertAccountEpoch(expected);
  const privateRequest =
    path.startsWith("/api/") && !path.startsWith("/api/auth/");
  const headers = new Headers(init?.headers);
  if (privateRequest && boundAccountId)
    headers.set("X-Account-ID", boundAccountId);
  const response = await fetch(path, { ...init, headers });
  handleUnauthorized(response.status, path);
  if (privateRequest && response.status === 409) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (data?.error?.code === "account_changed") leaveAccount(null);
  }
  assertAccountEpoch(expected);
  return response;
}
