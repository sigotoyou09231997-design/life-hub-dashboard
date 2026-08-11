import type { TripExpense } from "../../types";
import { getTripExpenseCategory } from "../../lib/tripCategories";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Receipt, Trash2 } from "lucide-react";

interface Props {
  budget?: number;
  expenses: TripExpense[];
  onEdit: (expense: TripExpense) => void;
  onDelete: (id: number) => void;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function TripExpenseList({ budget, expenses, onEdit, onDelete }: Props) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const paidTotal = expenses.filter((e) => e.paid).reduce((sum, e) => sum + e.amount, 0);
  const remaining = budget != null ? budget - total : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-400">予算</p>
            <p className="mt-0.5 font-semibold text-slate-900">{budget != null ? yen(budget) : "未設定"}</p>
          </div>
          <div>
            <p className="text-slate-400">支出合計</p>
            <p className="mt-0.5 font-semibold text-slate-900">{yen(total)}</p>
          </div>
          <div>
            <p className="text-slate-400">残り予算</p>
            <p className={`mt-0.5 font-semibold ${remaining != null && remaining < 0 ? "text-danger" : "text-slate-900"}`}>
              {remaining != null ? yen(remaining) : "—"}
            </p>
          </div>
          <div>
            <p className="text-slate-400">支払済み</p>
            <p className="mt-0.5 font-semibold text-success">{yen(paidTotal)}</p>
          </div>
        </div>
        {budget == null && <p className="mt-3 text-xs text-slate-400">予算は「概要」タブから設定できます。</p>}
      </Card>

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="費用がまだ登録されていません" description="下のボタンから追加できます。" />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const category = getTripExpenseCategory(e.category);
            return (
              <ListRow key={e.id} interactive className="p-0">
                <button
                  type="button"
                  onClick={() => onEdit(e)}
                  aria-label={`${e.title}を編集`}
                  className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                />
                <div className="pointer-events-none relative z-10 flex items-center justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium text-slate-900" title={e.title}>
                      {e.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={category.tone}>{category.label}</Badge>
                      <Badge tone={e.paid ? "success" : "neutral"}>{e.paid ? "支払済み" : "未払い"}</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold text-slate-900">{yen(e.amount)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (e.id && confirm(`「${e.title}」を削除しますか?`)) onDelete(e.id);
                      }}
                      aria-label="削除"
                      className="pointer-events-auto rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </ListRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
