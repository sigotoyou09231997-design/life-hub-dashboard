import type { TripExpense, TripExpenseCurrency } from "../../types";
import { getTripExpenseCategory } from "../../lib/tripCategories";
import { formatOriginalAmount } from "../../lib/currency";
import { splitExpenses } from "../../lib/tripMembers";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { Receipt, Trash2 } from "lucide-react";

interface Props {
  budget?: number;
  expenses: TripExpense[];
  onEdit: (expense: TripExpense) => void;
  onDelete: (id: string) => void;
  /** 現地通貨で入れた支出の内訳(支出id→行)。円で入れた支出には無い。 */
  currencies?: Map<string, TripExpenseCurrency>;
  /** 旅行の参加者。2人以上なら、誰がいくら払ったかと割り勘の差額を出す(src/lib/tripMembers.ts)。 */
  members?: string[];
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function TripExpenseList({ budget, expenses, onEdit, onDelete, currencies, members }: Props) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const paidTotal = expenses.filter((e) => e.paid).reduce((sum, e) => sum + e.amount, 0);
  const remaining = budget != null ? budget - total : undefined;
  const split = splitExpenses(expenses, members);

  return (
    <div className="space-y-4">
      <Card>
        {/* 金額は数字用の文字で(UI/UX 調査メモ 第4弾 B-1)。見出しの日本語はいつもの文字のまま。 */}
        <div className="num grid grid-cols-2 gap-4 text-sm">
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
        {budget == null && <p className="mt-3 text-xs text-slate-400">予算は右上の鉛筆(旅行を編集)から設定できます。</p>}
      </Card>

      {split && (split.total > 0 || split.unassigned > 0) && (
        <Card aria-label="割り勘">
          <p className="text-sm font-medium text-slate-700">
            {split.total > 0 ? `割り勘(${split.members.length}人・1人あたり ${yen(split.perPerson)})` : "割り勘"}
          </p>
          {split.total === 0 ? (
            <p className="mt-1 text-xs text-slate-400">費用ごとに「支払った人」を入れると、誰がいくら払えばいいかが出ます。</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {split.members.map((member) => (
                <li key={member.name} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-700">{member.name}</span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="text-xs text-slate-400">払った {yen(member.paid)}</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        Math.round(member.balance) > 0 ? "text-success" : Math.round(member.balance) < 0 ? "text-danger" : "text-slate-500"
                      }`}
                    >
                      {Math.round(member.balance) > 0
                        ? `${yen(member.balance)} 受け取る`
                        : Math.round(member.balance) < 0
                          ? `${yen(-member.balance)} 払う`
                          : "精算なし"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {split.total > 0 && split.unassigned > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              誰が払ったか決まっていない費用 {yen(split.unassigned)} は、割り勘に入れていません。
            </p>
          )}
        </Card>
      )}

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="費用がまだ登録されていません" description="下のボタンから追加できます。" card />
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const category = getTripExpenseCategory(e.category);
            const foreign = e.id ? currencies?.get(e.id) : undefined;
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
                      {e.paidBy && <span className="text-xs text-slate-500">{e.paidBy}が支払い</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="flex flex-col items-end">
                      <span className="text-sm font-semibold text-slate-900">{yen(e.amount)}</span>
                      {/* 現地通貨で入れた支出だけ、払った通貨の金額も添える。 */}
                      {foreign && (
                        <span className="text-xs text-slate-400">
                          {formatOriginalAmount(foreign.originalAmount, foreign.currency)}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      // 確認は聞かない。消したあと5秒間「元に戻す」が出る(UI/UX 調査メモ 第4弾 A-2。
                      // お知らせは TripDetailPage が出す)。
                      onClick={() => {
                        if (e.id) onDelete(e.id);
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
