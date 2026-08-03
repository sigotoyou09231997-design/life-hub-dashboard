import { Link } from "react-router-dom";
import { useBudget } from "../../hooks/useBudget";
import { Card } from "../ui/Card";
import { ChevronRight } from "lucide-react";

export function TodayBudgetCard() {
  const { budget } = useBudget();

  return (
    <Link to="/records/expense">
      <Card className="bg-accent text-white">
        <div className="flex items-center justify-between">
          <p className="text-sm text-white/70">今日使える金額</p>
          <ChevronRight size={18} className="text-white/70" />
        </div>
        <p className="mt-1.5 text-4xl font-bold">
          ¥{Math.max(0, Math.round(budget.todayUsable)).toLocaleString()}
        </p>
        <p className="mt-3 text-xs text-white/70">
          今月あと ¥{Math.round(budget.remainingThisMonth).toLocaleString()} 使えます
        </p>
      </Card>
    </Link>
  );
}
