import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, FixedCost, SalaryEntry } from "../../types";
import { monthRange } from "../../lib/date";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { ExpenseSummary } from "../../components/expense/ExpenseSummary";
import { ExpenseList } from "../../components/expense/ExpenseList";
import { ExpenseForm } from "../../components/expense/ExpenseForm";
import { FixedCostList } from "../../components/expense/FixedCostList";
import { FixedCostForm } from "../../components/expense/FixedCostForm";
import { SalaryList } from "../../components/expense/SalaryList";
import { SalaryForm } from "../../components/expense/SalaryForm";
import { PayPayImport } from "../../components/expense/PayPayImport";

type Tab = "summary" | "salary" | "fixed" | "history" | "paypay";

export default function ExpensePage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [editingTransaction, setEditingTransaction] = useState<Transaction | "new" | null>(null);
  const [editingFixedCost, setEditingFixedCost] = useState<FixedCost | "new" | null>(null);
  const [editingSalary, setEditingSalary] = useState<SalaryEntry | "new" | null>(null);

  const { start, end } = monthRange();
  const transactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const fixedCosts = useLiveQuery(() => db.fixedCosts.toArray(), []);
  const salaries = useLiveQuery(() => db.salaries.toArray(), []);

  return (
    <div className="pb-10">
      <PageHeader title="家計簿" subtitle="収支と固定費を管理" backTo="/" />

      <div className="mx-5 mb-4 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1">
        {([
          ["summary", "サマリー"],
          ["salary", "給与"],
          ["fixed", "固定費"],
          ["history", "履歴"],
          ["paypay", "PayPay"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg py-2 text-[11px] font-medium transition-colors ${
              tab === key ? "bg-white text-accent shadow-sm" : "text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-5">
        {tab === "summary" && <ExpenseSummary onAddSalary={() => setEditingSalary("new")} />}

        {tab === "salary" && (
          <>
            <SalaryList
              salaries={salaries ?? []}
              onEdit={(s) => setEditingSalary(s)}
              onDelete={(id) => db.salaries.delete(id)}
            />
            <Button className="mt-4 w-full" onClick={() => setEditingSalary("new")}>
              給与を追加
            </Button>
          </>
        )}

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

        {tab === "paypay" && <PayPayImport />}
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

      <Sheet
        open={editingSalary !== null}
        onClose={() => setEditingSalary(null)}
        title={editingSalary === "new" ? "給与を追加" : "給与を編集"}
      >
        {editingSalary && (
          <SalaryForm
            initial={editingSalary === "new" ? undefined : editingSalary}
            onSaved={() => setEditingSalary(null)}
            onCancel={() => setEditingSalary(null)}
          />
        )}
      </Sheet>
    </div>
  );
}
