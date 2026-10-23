import { NavLink } from "react-router-dom";
import { AudioLines, MessageCircle, Disc3 } from "lucide-react";
import "./MobileNavigation.css";

const items = [
  { to: "/home", label: "创作", icon: AudioLines },
  { to: "/assistant", label: "AI 助手", icon: MessageCircle },
  { to: "/library", label: "我的音乐", icon: Disc3 },
];

export function MobileNavigation({ taskCount }: { taskCount: number }) {
  return (
    <nav className="mobile-navigation" aria-label="底部导航">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className="mobile-navigation-item">
          <span className="mobile-navigation-icon" aria-hidden="true">
            <Icon size={21} strokeWidth={1.7} />
            {to === "/library" && taskCount > 0 && (
              <i className="mobile-navigation-task-dot" />
            )}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
