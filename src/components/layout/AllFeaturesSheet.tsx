import { Link } from "react-router-dom";
import { CalendarDays, Wallet, StickyNote, Plane, Mail, Settings as SettingsIcon, type LucideIcon } from "lucide-react";
import { Sheet } from "../ui/Sheet";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FeatureLink {
  to: string;
  label: string;
  icon: LucideIcon;
  color: string;
  bg: string;
}

const FEATURES: FeatureLink[] = [
  { to: "/schedule", label: "予定・タスク", icon: CalendarDays, color: "text-blue-500", bg: "bg-blue-50" },
  { to: "/records/expense", label: "お金管理", icon: Wallet, color: "text-orange-500", bg: "bg-orange-50" },
  { to: "/records/notes", label: "メモ・リスト", icon: StickyNote, color: "text-violet-500", bg: "bg-violet-50" },
  { to: "/trips", label: "旅行計画", icon: Plane, color: "text-teal-500", bg: "bg-teal-50" },
  { to: "/gmail", label: "Gmail自動返信", icon: Mail, color: "text-pink-500", bg: "bg-pink-50" },
  { to: "/settings", label: "設定", icon: SettingsIcon, color: "text-slate-500", bg: "bg-slate-100" },
];

/** Reached from QuickActionBar's grip handle. Holds every feature area, including
 * the ones the 5-icon bar deliberately doesn't have room for (旅行計画/設定) —
 * the bar itself stays fixed at 5 icons even as features are added later. */
export function AllFeaturesSheet({ open, onClose }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="すべての機能">
      <p className="-mt-2 mb-4 text-xs text-slate-400">よく使う5つを追加表示</p>
      <div className="grid grid-cols-3 gap-3">
        {FEATURES.map(({ to, label, icon: Icon, color, bg }) => (
          <Link
            key={to}
            to={to}
            onClick={onClose}
            className="glass-row flex flex-col items-center gap-2 rounded-2xl py-5 text-center transition-colors active:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} ${color}`}>
              <Icon size={20} />
            </div>
            <span className="text-xs font-medium text-slate-700">{label}</span>
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
