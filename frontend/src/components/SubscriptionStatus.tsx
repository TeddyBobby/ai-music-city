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
      <div className="subscription-heading">
        <Crown size={18} strokeWidth={1.7} aria-hidden="true" />
        <span>演示</span>
      </div>
      <div className="subscription-copy">
        <strong>{plan.name}</strong>
        <small>每月 {plan.monthlySongs} 首 · 查看套餐</small>
      </div>
      <ChevronRight
        className="subscription-chevron"
        size={16}
        aria-hidden="true"
      />
    </NavLink>
  );
}
