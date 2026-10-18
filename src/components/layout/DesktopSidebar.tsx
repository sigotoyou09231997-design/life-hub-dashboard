import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  Home,
  Landmark,
  Leaf,
  LineChart,
  Mail,
  NotebookPen,
  Plane,
  Settings,
  UserRound,
} from "lucide-react";
import { useHiddenFeatures } from "../../hooks/useHiddenFeatures";
import { isPathHidden } from "../../lib/hiddenFeatures";

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
  // 設定の「使う機能」で隠した機能は、メニューに出さない(src/lib/hiddenFeatures.ts)。ホームと設定は隠せない。
  const hidden = useHiddenFeatures();
  const primary = PRIMARY_NAV.filter((item) => !isPathHidden(item.to, hidden));
  const secondary = SECONDARY_NAV.filter((item) => !isPathHidden(item.to, hidden));
  return (
    <aside className="desktop-sidebar" aria-label="メインナビゲーション">
      <NavLink to="/" className="sidebar-brand" aria-label="LIFE HUB ホーム">
        {/* 参考デザインのロゴまわりの葉のモチーフ。 */}
        <span className="sidebar-brand__mark"><Leaf size={18} strokeWidth={1.7} /></span>
        <span>
          <span className="sidebar-brand__name">LIFE HUB</span>
        </span>
      </NavLink>

      <nav className="sidebar-nav">
        <div className="sidebar-nav__group sidebar-nav__group--secondary">
          {primary.map((item) => <SidebarLink key={item.to} {...item} />)}
        </div>
        <div className="sidebar-nav__divider" />
        <div className="sidebar-nav__group">
          {secondary.map((item) => <SidebarLink key={item.to} {...item} />)}
        </div>
      </nav>

      {/* 参考デザインではサイドバーの一番下が「プロフィールカード」になっている。
          プラン名などこのアプリに無い情報は出さず、見た目だけカードに寄せる
          （丸いアバター＋名前＋行き先を示す山かっこ）。 */}
      <NavLink to="/account" className="sidebar-account" aria-label="アカウント" data-label="アカウント">
        <span className="sidebar-account__avatar"><UserRound size={22} strokeWidth={1.6} /></span>
        <span className="sidebar-account__text">
          <span className="sidebar-account__name">アカウント</span>
          <span className="sidebar-account__sub">プロフィールと同期</span>
        </span>
        <ChevronRight className="sidebar-account__chevron" size={16} strokeWidth={2} aria-hidden="true" />
      </NavLink>
    </aside>
  );
}
