import { useState } from "react";
import { Modal, SegmentedControl, UnstyledButton } from "@mantine/core";
import {
  ArrowUpRight,
  Check,
  Info,
  Music2,
  Sparkles,
  Sprout,
} from "lucide-react";
import { Button } from "../components/ui";
import { plans, useSubscriptionPreview } from "../lib/subscriptionPreview";
import { useApp } from "../state/app";
import "./Pricing.css";

type BillingCycle = "monthly" | "yearly";
type Plan = (typeof plans)[number];

const planDetails = {
  free: {
    icon: Sprout,
    priority: "标准队列",
    format: "MP3",
  },
  inspiration: {
    icon: Music2,
    priority: "优先队列",
    format: "MP3 / 无损",
  },
  creator: {
    icon: Sparkles,
    priority: "更高优先级",
    format: "MP3 / 无损",
  },
};

const cycleLabel = (cycle: BillingCycle) =>
  cycle === "yearly" ? "年付" : "月付";

function orderAmount(plan: Plan, cycle: BillingCycle) {
  if (plan.id === "free") return 0;
  return cycle === "yearly" ? (plan.yearlyPrice ?? 0) : plan.monthlyPrice;
}

export function PricingPage() {
  const { selection, selectPlan } = useSubscriptionPreview();
  const [cycle, setCycle] = useState<BillingCycle>(selection.cycle);
  const [order, setOrder] = useState<{
    plan: Plan;
    cycle: BillingCycle;
  } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  function confirmPreview() {
    if (!order) return;
    const selectedCycle = order.plan.id === "free" ? "monthly" : order.cycle;
    selectPlan(order.plan.id, selectedCycle);
    useApp
      .getState()
      .toast(
        `已切换为${order.plan.name}${order.plan.id === "free" ? "" : ` · ${cycleLabel(selectedCycle)}`}，不会产生扣费。`,
      );
    setOrder(null);
  }

  return (
    <div className="pricing-page">
      <div className="pricing-toolbar">
        <header className="pricing-heading">
          <h1>给灵感，多一点可能。</h1>
        </header>

        <div className="pricing-cycle-row">
          <SegmentedControl
            aria-label="订阅周期"
            className="pricing-cycle"
            classNames={{
              label: "pricing-cycle-label",
              indicator: "pricing-cycle-indicator",
            }}
            value={cycle}
            onChange={(value) => {
              if (value === "monthly" || value === "yearly") setCycle(value);
            }}
            data={[
              { label: "月付", value: "monthly" },
              { label: "年付", value: "yearly" },
            ]}
            withItemsBorders={false}
            radius="xl"
          />
          <span className="pricing-yearly-note">年付更划算</span>
        </div>
      </div>

      <section className="pricing-plans" aria-label="订阅方案">
        {plans.map((plan) => {
          const details = planDetails[plan.id];
          const Icon = details.icon;
          const featured = plan.id === "inspiration";
          const current =
            selection.planId === plan.id &&
            (plan.id === "free" || selection.cycle === cycle);
          const yearly = cycle === "yearly" && plan.id !== "free";
          const price = yearly
            ? (plan.yearlyPrice ?? 0) / 12
            : plan.monthlyPrice;

          return (
            <article
              key={plan.id}
              className={`pricing-plan${featured ? " is-featured" : ""}${current ? " is-current" : ""}`}
              aria-label={`${plan.name}${current ? "，当前方案" : ""}`}
            >
              <div className="pricing-plan-top">
                <span className="pricing-plan-icon">
                  <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <h2>{plan.name}</h2>
                {current ? (
                  <span className="pricing-plan-tag">当前方案</span>
                ) : featured ? (
                  <span className="pricing-plan-tag">推荐</span>
                ) : null}
              </div>
              <div className="pricing-price">
                <span className="pricing-currency">¥</span>
                <strong>{price}</strong>
                <span>/ 月</span>
              </div>
              <p className="pricing-billing">
                {plan.id === "free"
                  ? "免费使用"
                  : yearly
                    ? `年付 ¥${plan.yearlyPrice}，折合月均`
                    : "按月付费"}
              </p>
              <Button
                className="pricing-plan-button"
                variant={featured ? "primary" : ""}
                disabled={current}
                onClick={() => setOrder({ plan, cycle })}
                aria-label={`${current ? "当前方案" : "体验此方案"}：${plan.name}${plan.id === "free" ? "" : `，${cycleLabel(cycle)}`}`}
              >
                {current ? "当前方案" : "体验方案"}
                {!current && <ArrowUpRight size={16} aria-hidden="true" />}
              </Button>
              <ul className="pricing-features">
                <li className="pricing-quota">
                  <Check size={16} aria-hidden="true" />
                  <span>
                    每月 <strong>{plan.monthlySongs}</strong> 首
                  </span>
                </li>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>{details.priority}</span>
                </li>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>{details.format}</span>
                </li>
              </ul>
            </article>
          );
        })}
      </section>

      <footer className="pricing-notes">
        <div>
          <p className="pricing-common">均支持文字、哼唱、图片创作与 AI 助手</p>
          <p>演示套餐，不会扣费</p>
        </div>
        <UnstyledButton
          className="pricing-details-button"
          onClick={() => setDetailsOpen(true)}
        >
          <Info size={15} aria-hidden="true" />
          价格说明
        </UnstyledButton>
      </footer>

      <Modal
        opened={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="价格说明"
        centered
        size={420}
        classNames={{
          content: "pricing-order-modal",
          header: "pricing-order-header",
        }}
        closeButtonProps={{ "aria-label": "关闭价格说明" }}
      >
        <ul className="pricing-detail-rules">
          <li>
            所有方案均支持文字、哼唱、图片创作、纯音乐与带歌词音乐，以及 AI
            助手。
          </li>
          <li>按成功生成的作品计次，失败不扣。年付方案的额度按月发放。</li>
          <li>
            灵感会员年付 ¥288，折合 ¥24 / 月；创作家年付 ¥768，折合 ¥64 /
            月。年付订单一次展示全年总额。
          </li>
          <li>
            套餐价格、生成优先级与下载格式仅供演示，不会扣费，也不限制现有创作。
          </li>
        </ul>
      </Modal>

      <Modal
        opened={Boolean(order)}
        onClose={() => setOrder(null)}
        title="确认体验方案"
        centered
        size={420}
        padding="lg"
        classNames={{
          content: "pricing-order-modal",
          header: "pricing-order-header",
          body: "pricing-order-body",
        }}
        overlayProps={{ backgroundOpacity: 0.25, blur: 4 }}
        closeButtonProps={{ "aria-label": "关闭订单小结" }}
      >
        {order && (
          <>
            <span className="pricing-demo-label">模拟订单</span>
            <dl className="pricing-order-summary">
              <div>
                <dt>方案</dt>
                <dd>{order.plan.name}</dd>
              </div>
              <div>
                <dt>周期</dt>
                <dd>
                  {order.plan.id === "free"
                    ? "免费使用"
                    : `${cycleLabel(order.cycle)} · ${order.cycle === "yearly" ? "12 个月" : "1 个月"}`}
                </dd>
              </div>
              <div>
                <dt>展示额度</dt>
                <dd>{order.plan.monthlySongs} 首 / 月</dd>
              </div>
              <div className="pricing-order-total">
                <dt>模拟订单总额</dt>
                <dd>¥{orderAmount(order.plan, order.cycle)}</dd>
              </div>
            </dl>
            <p className="pricing-order-note">
              仅演示，不会扣费；额度不影响现有创作。
            </p>
            <Button
              variant="primary"
              className="pricing-order-confirm"
              onClick={confirmPreview}
            >
              确认模拟订阅
            </Button>
          </>
        )}
      </Modal>
    </div>
  );
}
