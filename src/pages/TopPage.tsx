import { Link } from "react-router-dom";
import { Wallet, CalendarClock, StickyNote, Plane, Settings } from "lucide-react";
import { format } from "date-fns";

const TOP_CARDS = [
  {
    to: "/records/expense",
    label: "お金管理",
    description: "収支・固定費・給与",
    icon: Wallet,
  },
  {
    to: "/schedule",
    label: "予定・タスク管理",
    description: "予定とタスクを確認",
    icon: CalendarClock,
  },
  {
    to: "/records/notes",
    label: "メモ・リスト",
    description: "メモや各種リスト",
    icon: StickyNote,
  },
  {
    to: "/trips",
    label: "旅行計画",
    description: "旅の準備をまとめて",
    icon: Plane,
  },
];

export default function TopPage() {
  return (
    <div className="min-h-screen pb-10">
      <div className="flex items-start justify-between px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <div>
          <h1 className="text-2xl font-bold text-navy">LIFE HUB</h1>
          <p className="mt-0.5 text-sm text-slate-400">{format(new Date(), "yyyy年M月d日(E)")}</p>
        </div>
        <Link
          to="/settings"
          aria-label="設定"
          className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 active:bg-slate-100"
        >
          <Settings size={22} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5">
        {TOP_CARDS.map(({ to, label, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-transform active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-white">
              <Icon size={22} />
            </div>
            <div>
              <p className="font-semibold text-navy">{label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
