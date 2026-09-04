import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, FixedCost, SalaryEntry } from "../../types";
import { monthRange, todayStr } from "../../lib/date";
import { EXPENSE_CATEGORIES } from "../../lib/categories";
import type { ExtractedReceipt } from "../../lib/receiptScan";
import { AREA_ACCENT_STYLE } from "../../lib/areaColors";
import { PageHeader } from "../../components/ui/PageHeader";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { Tabs } from "../../components/ui/Tabs";
import { ExpenseSummary } from "../../components/expense/ExpenseSummary";
import { ExpenseList } from "../../components/expense/ExpenseList";
import { ExpenseForm } from "../../components/expense/ExpenseForm";
import { ReceiptScanForm } from "../../components/expense/ReceiptScanForm";
import { FixedCostList } from "../../components/expense/FixedCostList";
import { FixedCostForm } from "../../components/expense/FixedCostForm";
import { SalaryList } from "../../components/expense/SalaryList";
import { SalaryForm } from "../../components/expense/SalaryForm";
import { SalaryDeductionBreakdown } from "../../components/expense/SalaryDeductionBreakdown";
import { SalaryCsvImport } from "../../components/expense/SalaryCsvImport";
import { PayPayImport } from "../../components/expense/PayPayImport";
import { GenericCsvImport } from "../../components/expense/GenericCsvImport";
import { TransactionCsvExport } from "../../components/expense/TransactionCsvExport";
import { useToast } from "../../components/ui/ToastProvider";
import { ListSkeleton } from "../../components/ui/ListSkeleton";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";

/** レシート読み取り結果を、支出フォームへの下書きにする。idを持たせないので、
 * ExpenseFormは「新規追加」として保存する(既存の編集判定はinitial?.idを見ている)。 */
function receiptToDraftTransaction(receipt: ExtractedReceipt): Transaction {
  return {
    type: "expense",
    amount: receipt.amount ?? 0,
    category: receipt.category ?? EXPENSE_CATEGORIES[0],
    method: receipt.paymentMethod,
    store: receipt.storeName,
    memo: receipt.memo,
    date: receipt.date ?? todayStr(),
    isFixed: false,
    createdAt: Date.now(),
  };
}

type Tab = "summary" | "salary" | "fixed" | "history" | "paypay";

export default function ExpensePage() {
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>("summary");
  const [editingTransaction, setEditingTransaction] = useState<Transaction | "new" | null>(null);
  const [editingFixedCost, setEditingFixedCost] = useState<FixedCost | "new" | null>(null);
  const [editingSalary, setEditingSalary] = useState<SalaryEntry | "new" | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [salaryCsvImportOpen, setSalaryCsvImportOpen] = useState(false);
  const [receiptScanOpen, setReceiptScanOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // アプリアイコン長押しのショートカット(vite.config.ts の manifest.shortcuts)から
  // ?new=expense で来たときは、収支の追加フォームを開いた状態で始める。合わせて
  // 履歴タブへ移す — 保存したあとに何が増えたのかが見える場所で終わるようにする。
  // 開いたら印はURLから消す(残すと、閉じたあとの再読み込みや戻るでまた開く)。
  useEffect(() => {
    if (searchParams.get("new") !== "expense") return;
    setTab("history");
    setEditingTransaction("new");
    const rest = new URLSearchParams(searchParams);
    rest.delete("new");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  // レシート読み取りからの下書きは、idを持たないオブジェクトとして開く(新規追加)。
  const isTransactionDraft = typeof editingTransaction === "object" && editingTransaction !== null && !editingTransaction.id;

  const { start, end } = monthRange();
  const transactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const fixedCosts = useLiveQuery(() => db.fixedCosts.toArray(), []);
  const salaries = useLiveQuery(() => db.salaries.toArray(), []);
  const showSalarySkeleton = useDelayedFlag(salaries === undefined);
  const showHistorySkeleton = useDelayedFlag(transactions === undefined);
  const showFixedSkeleton = useDelayedFlag(fixedCosts === undefined);

  // 0件のときだけ、作業面を画面の下まで伸ばす(.is-empty-fill、index.css)。読み込み中
  // (undefined)は伸ばさない — 中身が入るかどうかがまだ分からないため。
  const noSalaries = salaries?.length === 0;
  const noTransactions = transactions?.length === 0;
  const noFixedCosts = fixedCosts?.length === 0;

  return (
    <div className="spatial-page finance-page micro-contrast pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.money}>
      <PageHeader title="お金管理" subtitle="収支と固定費を管理" backTo="/" />

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-6 lg:max-w-[840px]">
        <Tabs
          options={[
            { value: "summary", label: "サマリー" },
            { value: "salary", label: "給与" },
            { value: "fixed", label: "固定費" },
            { value: "history", label: "履歴" },
            { value: "paypay", label: "PayPay" },
          ]}
          value={tab}
          onChange={setTab}
          dense
        />
      </div>

      <div className={`spatial-page-content finance-workspace finance-workspace--${tab} px-5 lg:px-8`}>
        {tab === "summary" && <ExpenseSummary onAddSalary={() => setEditingSalary("new")} />}

        {tab === "salary" && (
          <div className={`finance-ledger-workspace ${noSalaries ? "is-empty-fill" : ""}`}>
            {showSalarySkeleton ? (
              <ListSkeleton />
            ) : (
              <>
                <SalaryDeductionBreakdown salaries={salaries ?? []} />
                <div className="mt-4">
                  <SalaryList
                    salaries={salaries ?? []}
                    onEdit={(s) => setEditingSalary(s)}
                    onDelete={(id) => {
                      db.salaries.delete(id);
                      showToast("削除しました");
                    }}
                  />
                </div>
              </>
            )}
            <div className="mt-4 flex gap-2">
              <Button className="flex-1" onClick={() => setEditingSalary("new")}>
                給与を追加
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setSalaryCsvImportOpen(true)}>
                CSVから取込
              </Button>
            </div>
          </div>
        )}

        {tab === "history" && (
          <div className={`finance-ledger-workspace ${noTransactions ? "is-empty-fill" : ""}`}>
            {showHistorySkeleton ? (
              <ListSkeleton />
            ) : (
              <ExpenseList
                transactions={transactions ?? []}
                onEdit={(t) => setEditingTransaction(t)}
                onDelete={(id) => {
                  db.transactions.delete(id);
                  showToast("削除しました");
                }}
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => setEditingTransaction("new")}>
                収支を追加
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setReceiptScanOpen(true)}>
                レシートから追加
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setCsvImportOpen(true)}>
                CSVから取込
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setCsvExportOpen(true)}>
                CSVで書き出す
              </Button>
            </div>
          </div>
        )}

        {tab === "fixed" && (
          <div className={`finance-ledger-workspace ${noFixedCosts ? "is-empty-fill" : ""}`}>
            {showFixedSkeleton ? (
              <ListSkeleton />
            ) : (
              <FixedCostList
                fixedCosts={fixedCosts ?? []}
                onEdit={(f) => setEditingFixedCost(f)}
                onDelete={(id) => {
                  db.fixedCosts.delete(id);
                  showToast("削除しました");
                }}
              />
            )}
            <Button className="mt-4 w-full" onClick={() => setEditingFixedCost("new")}>
              固定費を追加
            </Button>
          </div>
        )}

        {tab === "paypay" && <PayPayImport />}
      </div>

      <Sheet
        open={editingTransaction !== null}
        onClose={() => setEditingTransaction(null)}
        title={isTransactionDraft ? "レシートの内容を確認" : editingTransaction === "new" ? "収支を追加" : "収支を編集"}
      >
        {editingTransaction && (
          <ExpenseForm
            initial={editingTransaction === "new" ? undefined : editingTransaction}
            submitLabel={isTransactionDraft ? "この内容で記録する" : undefined}
            onSaved={() => {
              setEditingTransaction(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingTransaction(null)}
          />
        )}
      </Sheet>

      <Sheet open={receiptScanOpen} onClose={() => setReceiptScanOpen(false)} title="レシートから追加">
        {receiptScanOpen && (
          <ReceiptScanForm
            onExtracted={(receipt) => {
              setReceiptScanOpen(false);
              setEditingTransaction(receiptToDraftTransaction(receipt));
            }}
            onCancel={() => setReceiptScanOpen(false)}
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
            onSaved={() => {
              setEditingFixedCost(null);
              showToast("保存しました");
            }}
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
            onSaved={() => {
              setEditingSalary(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingSalary(null)}
          />
        )}
      </Sheet>

      <Sheet open={csvImportOpen} onClose={() => setCsvImportOpen(false)} title="CSVから取込">
        {csvImportOpen && <GenericCsvImport onClose={() => setCsvImportOpen(false)} />}
      </Sheet>

      <Sheet open={csvExportOpen} onClose={() => setCsvExportOpen(false)} title="CSVで書き出す">
        {csvExportOpen && <TransactionCsvExport onClose={() => setCsvExportOpen(false)} />}
      </Sheet>

      <Sheet open={salaryCsvImportOpen} onClose={() => setSalaryCsvImportOpen(false)} title="給与明細CSVから取込">
        {salaryCsvImportOpen && <SalaryCsvImport onClose={() => setSalaryCsvImportOpen(false)} />}
      </Sheet>
    </div>
  );
}
