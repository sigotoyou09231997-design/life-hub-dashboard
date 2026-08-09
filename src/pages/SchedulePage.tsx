import { Link } from "react-router-dom";
import { Calendar, CheckSquare, ChevronRight } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";

const ITEMS = [
  { to: "/calendar", label: "予定", description: "カレンダーで確認", icon: Calendar },
  { to: "/records/tasks", label: "タスク", description: "やることを管理", icon: CheckSquare },
];

export default function SchedulePage() {
  return (
    <div className="pb-10">
      <PageHeader title="予定・タスク管理" backTo="/" />
      <div className="space-y-2 px-5">
        {ITEMS.map(({ to, label, description, icon: Icon }) => (
          <Link key={to} to={to}>
            <Card className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-light text-accent">
                  <Icon size={20} />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-400">{description}</p>
                </div>
              </div>
              <ChevronRight size={18} className="text-slate-300" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
