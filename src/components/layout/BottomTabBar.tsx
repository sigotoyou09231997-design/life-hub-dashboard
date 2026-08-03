import { NavLink } from "react-router-dom";
import { Home, Calendar, Plus, LayoutList, Settings } from "lucide-react";

interface Props {
  onAddClick: () => void;
}

function navItemClass({ isActive }: { isActive: boolean }) {
  return `flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] ${
    isActive ? "text-accent" : "text-slate-400"
  }`;
}

export function BottomTabBar({ onAddClick }: Props) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md items-center">
        <NavLink to="/" end className={navItemClass}>
          <Home size={22} />
          ホーム
        </NavLink>
        <NavLink to="/calendar" className={navItemClass}>
          <Calendar size={22} />
          カレンダー
        </NavLink>
        <div className="flex flex-1 justify-center">
          <button
            onClick={onAddClick}
            aria-label="追加"
            className="-mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-transform active:scale-95"
          >
            <Plus size={28} />
          </button>
        </div>
        <NavLink to="/records" className={navItemClass}>
          <LayoutList size={22} />
          記録
        </NavLink>
        <NavLink to="/settings" className={navItemClass}>
          <Settings size={22} />
          設定
        </NavLink>
      </div>
    </nav>
  );
}
