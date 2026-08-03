import { Link } from "react-router-dom";
import { Wallet, CheckSquare, StickyNote, BookHeart, Target, Flame, ChevronRight } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";

const ITEMS = [
  { to: "/records/expense", label: "家計簿", icon: Wallet },
  { to: "/records/tasks", label: "タスク", icon: CheckSquare },
  { to: "/records/notes", label: "メモ", icon: StickyNote },
  { to: "/records/diary", label: "日記", icon: BookHeart },
  { to: "/records/goals", label: "目標", icon: Target },
  { to: "/records/habits", label: "習慣", icon: Flame },
];

export default function RecordsPage() {
  return (
    <div className="pb-28">
      <PageHeader title="記録" subtitle="すべての記録をここから" />
      <div className="space-y-2 px-5">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent">
                  <Icon size={20} />
                </div>
                <span className="font-medium text-slate-900">{label}</span>
              </div>
              <ChevronRight size={18} className="text-slate-300" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
