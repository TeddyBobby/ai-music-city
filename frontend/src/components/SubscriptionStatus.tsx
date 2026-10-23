import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Crown } from "lucide-react";
import { plans, useSubscriptionPreview } from "../lib/subscriptionPreview";
import "./SubscriptionStatus.css";

export function SubscriptionStatus() {
  const location = useLocation();
  const { selection } = useSubscriptionPreview();
  const plan = plans.find((item) => item.id === selection.planId) || plans[0];

  return (
    <NavLink
      to="/pricing"
      state={{ pricingFrom: location.pathname + location.search }}
      className="sidebar-subscription"
      aria-label={`订阅与定价：${plan.name}，演示方案`}
    >
      <Crown
        className="subscription-icon"
        size={18}
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <div className="subscription-copy">
        <strong>{plan.name}</strong>
        <small>{plan.monthlySongs} 首 / 月</small>
      </div>
      <span className="subscription-demo">演示</span>
      <ChevronRight
        className="subscription-chevron"
        size={16}
        aria-hidden="true"
      />
    </NavLink>
  );
}
