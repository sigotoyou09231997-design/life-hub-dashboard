import { Link } from "react-router-dom";
import { BookHeart, Target, Flame, ChevronRight } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";

const ITEMS = [
  { to: "/records/diary", label: "日記", icon: BookHeart },
  { to: "/records/goals", label: "目標", icon: Target },
  { to: "/records/habits", label: "習慣", icon: Flame },
];

export default function RecordsPage() {
  return (
    <div className="pb-10">
      <PageHeader title="以前の記録" subtitle="日記・目標・習慣のデータはそのまま残っています" backTo="/settings" />
      <div className="space-y-2 px-5">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <Card interactive className="flex items-center justify-between py-4">
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
