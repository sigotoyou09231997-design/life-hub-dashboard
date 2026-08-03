import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, FixedCost } from "../../types";
import { monthRange } from "../../lib/date";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { ExpenseSummary } from "../../components/expense/ExpenseSummary";
import { ExpenseList } from "../../components/expense/ExpenseList";
import { ExpenseForm } from "../../components/expense/ExpenseForm";
import { FixedCostList } from "../../components/expense/FixedCostList";
import { FixedCostForm } from "../../components/expense/FixedCostForm";

type Tab = "summary" | "history" | "fixed";

export default function ExpensePage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [editingTransaction, setEditingTransaction] = useState<Transaction | "new" | null>(null);
  const [editingFixedCost, setEditingFixedCost] = useState<FixedCost | "new" | null>(null);

  const { start, end } = monthRange();
  const transactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const fixedCosts = useLiveQuery(() => db.fixedCosts.toArray(), []);

  return (
    <div className="pb-28">
      <PageHeader title="家計簿" subtitle="収支と固定費を管理" />

      <div className="mx-5 mb-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {([
          ["summary", "サマリー"],
          ["history", "履歴"],
          ["fixed", "固定費"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === key ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-5">
        {tab === "summary" && <ExpenseSummary />}

        {tab === "history" && (
          <>
            <ExpenseList
              transactions={transactions ?? []}
              onEdit={(t) => setEditingTransaction(t)}
              onDelete={(id) => db.transactions.delete(id)}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingTransaction("new")}>
              収支を追加
            </Button>
          </>
        )}

        {tab === "fixed" && (
          <>
            <FixedCostList
              fixedCosts={fixedCosts ?? []}
              onEdit={(f) => setEditingFixedCost(f)}
              onDelete={(id) => db.fixedCosts.delete(id)}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingFixedCost("new")}>
              固定費を追加
            </Button>
          </>
        )}
      </div>

      <Sheet
        open={editingTransaction !== null}
        onClose={() => setEditingTransaction(null)}
        title={editingTransaction === "new" ? "収支を追加" : "収支を編集"}
      >
        {editingTransaction && (
          <ExpenseForm
            initial={editingTransaction === "new" ? undefined : editingTransaction}
            onSaved={() => setEditingTransaction(null)}
            onCancel={() => setEditingTransaction(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={editingFixedCost !== null}
        onClose={() => setEditingFixedCost(null)}
        title={editingFixedCost === "new" ? "固定費を追加" : "固定費を編集"}
      >
        {editingFixedCost && (
          <FixedCostForm
            initial={editingFixedCost === "new" ? undefined : editingFixedCost}
            onSaved={() => setEditingFixedCost(null)}
            onCancel={() => setEditingFixedCost(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
