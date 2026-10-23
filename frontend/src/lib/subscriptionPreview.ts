import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "../state/auth";

export type PlanId = "free" | "inspiration" | "creator";
export type BillingCycle = "monthly" | "yearly";

export const plans: {
  id: PlanId;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlySongs: number;
}[] = [
  {
    id: "free",
    name: "体验版",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlySongs: 5,
  },
  {
    id: "inspiration",
    name: "灵感会员",
    monthlyPrice: 29,
    yearlyPrice: 288,
    monthlySongs: 50,
  },
  {
    id: "creator",
    name: "创作家",
    monthlyPrice: 79,
    yearlyPrice: 768,
    monthlySongs: 200,
  },
];

type Selection = { planId: PlanId; cycle: BillingCycle };
const defaultSelection: Selection = { planId: "free", cycle: "monthly" };
const storagePrefix = "amc.subscription.preview.v1:";
const selections = new Map<string, Selection>();
const listeners = new Set<() => void>();

// This is an account-scoped UI demo only. It never purchases a subscription,
// changes real quotas or permissions, or serves as an entitlement check.
function normalize(value: unknown): Selection | null {
  if (!value || typeof value !== "object") return null;
  const { planId, cycle } = value as Partial<Selection>;
  if (
    !plans.some((plan) => plan.id === planId) ||
    (cycle !== "monthly" && cycle !== "yearly")
  )
    return null;
  return { planId, cycle: planId === "free" ? "monthly" : cycle };
}

function storageKey(userId: string) {
  return `${storagePrefix}${encodeURIComponent(userId)}`;
}

function parseSelection(serialized: string | null): Selection {
  try {
    return normalize(JSON.parse(serialized)) || defaultSelection;
  } catch {
    return defaultSelection;
  }
}

function selectionFor(userId: string | null): Selection {
  if (!userId) return defaultSelection;
  const cached = selections.get(userId);
  if (cached) return cached;
  let selection = defaultSelection;
  try {
    selection = parseSelection(window.localStorage.getItem(storageKey(userId)));
  } catch {
    // Private browsing, a full disk, or old/corrupt demo data must not block UI.
  }
  selections.set(userId, selection);
  return selection;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.storageArea && event.storageArea !== window.localStorage) return;
  if (event.key === null) {
    selections.clear();
  } else {
    if (!event.key.startsWith(storagePrefix)) return;
    try {
      const userId = decodeURIComponent(event.key.slice(storagePrefix.length));
      const selection = parseSelection(event.newValue);
      selections.set(userId, selection);
    } catch {
      // An unrelated malformed key cannot invalidate other accounts' previews.
      return;
    }
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", onStorage);
  };
}

export function useSubscriptionPreview(): {
  selection: Selection;
  selectPlan: (planId: PlanId, cycle: BillingCycle) => void;
} {
  const userId = useAuth((state) => state.user?.id || null);
  const getSnapshot = useCallback(() => selectionFor(userId), [userId]);
  const selection = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultSelection,
  );
  const selectPlan = useCallback(
    (planId: PlanId, cycle: BillingCycle) => {
      // Ignore a callback left over from a previous account (or signed-out UI).
      if (!userId || useAuth.getState().user?.id !== userId) return;
      const next = normalize({ planId, cycle });
      if (!next) return;
      const previous = selectionFor(userId);
      if (previous.planId === next.planId && previous.cycle === next.cycle)
        return;
      selections.set(userId, next);
      try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
      } catch {
        // In-memory publication still synchronizes every consumer on this page.
      }
      notify();
    },
    [userId],
  );
  return { selection, selectPlan };
}
