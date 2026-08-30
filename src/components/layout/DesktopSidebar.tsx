import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarDays,
  Home,
  Landmark,
  LineChart,
  Mail,
  NotebookPen,
  Plane,
  Settings,
  UserRound,
} from "lucide-react";

const PRIMARY_NAV = [
  { to: "/", label: "ホーム", icon: Home },
  { to: "/schedule", label: "予定・タスク", icon: CalendarDays },
  { to: "/records/expense", label: "お金管理", icon: Landmark },
  { to: "/records/notes", label: "メモ・リスト", icon: NotebookPen },
  { to: "/gmail", label: "Gmail", icon: Mail },
  { to: "/trips", label: "旅行計画", icon: Plane },
];

const SECONDARY_NAV = [
  { to: "/review", label: "ふりかえり", icon: LineChart },
  { to: "/settings", label: "設定", icon: Settings },
];

function SidebarLink({ to, label, icon: Icon }: (typeof PRIMARY_NAV)[number]) {
  const location = useLocation();
  const active = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
  return (
    <NavLink
      to={to}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-label={label}
      className={`sidebar-link ${active ? "sidebar-link--active" : ""}`}
    >
      <span className="sidebar-link__indicator" aria-hidden="true" />
      <Icon size={21} strokeWidth={1.7} />
      <span>{label}</span>
    </NavLink>
  );
}

export function DesktopSidebar() {
  return (
    <aside className="desktop-sidebar" aria-label="メインナビゲーション">
      <NavLink to="/" className="sidebar-brand" aria-label="LIFE HUB ホーム">
        <span className="sidebar-brand__mark">LH</span>
        <span className="sidebar-brand__name">LIFE HUB</span>
      </NavLink>

      <nav className="sidebar-nav">
        <div className="sidebar-nav__group sidebar-nav__group--secondary">
          {PRIMARY_NAV.map((item) => <SidebarLink key={item.to} {...item} />)}
        </div>
        <div className="sidebar-nav__divider" />
        <div className="sidebar-nav__group">
          {SECONDARY_NAV.map((item) => <SidebarLink key={item.to} {...item} />)}
        </div>
      </nav>

      <NavLink to="/account" className="sidebar-account" aria-label="アカウント" data-label="アカウント">
        <span className="sidebar-account__avatar"><UserRound size={20} strokeWidth={1.6} /></span>
        <span className="text-sm font-semibold text-slate-700">アカウント</span>
      </NavLink>
    </aside>
  );
}
