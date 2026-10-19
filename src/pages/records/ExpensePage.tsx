import { useEffect, useState } from "react";
import { ArrowLeft, CreditCard, Download, FileUp, Plus, ReceiptText, Smartphone } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, SalaryEntry } from "../../types";
import { monthRange, todayStr } from "../../lib/date";
import { EXPENSE_CATEGORIES } from "../../lib/categories";
import { selectBonuses } from "../../lib/bonus";
import { deleteProjectTagFor } from "../../lib/projectTags";
import { EXPENSE_INITIAL_TAB, resolveExpenseTabRequest, type ExpenseTab } from "../../lib/expenseTabs";
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
import { SubscriptionTab, openSubscriptionAdd } from "../../components/subscriptions/SubscriptionTab";
import { FixedCostTab, openFixedCostAdd } from "../../components/fixedCosts/FixedCostTab";
import { SalaryList } from "../../components/expense/SalaryList";
import { BonusForm } from "../../components/expense/BonusForm";
import { BonusList } from "../../components/expense/BonusList";
import { SalaryForm } from "../../components/expense/SalaryForm";
import { SalaryDeductionBreakdown } from "../../components/expense/SalaryDeductionBreakdown";
import { SalaryCsvImport } from "../../components/expense/SalaryCsvImport";
import { PayPayImport } from "../../components/expense/PayPayImport";
import { PendingCardChargeList } from "../../components/expense/PendingCardChargeList";
import { GenericCsvImport } from "../../components/expense/GenericCsvImport";
import { TransactionCsvExport } from "../../components/expense/TransactionCsvExport";
import { useToast } from "../../components/ui/ToastProvider";
import { deleteRowWithUndo, quoted } from "../../components/ui/undoToast";
import { useWithoutPendingDeletes } from "../../hooks/usePendingDeletes";
import { ListSkeleton } from "../../components/ui/ListSkeleton";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { PageFab } from "../../components/ui/PageFab";
import { useExpenseStatus } from "../../hooks/usePageStatus";

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

// 2026-10-12: 固定費のタブを「サブスク」に作り替えて先頭に置いた(参考: サブスクBOX)。
// 開いたときに最初に出るのもサブスク。固定費の中身はそのまま、サブスクの一覧に並ぶ。
// 同じ日に「カード」「PayPay」をタブから外した(UI/UX 調査メモ C-2)。どちらも見る場所ではなく
// 取り込みの方法なので、履歴タブの「ほかの方法」に入れた。タブは6個2段 → 4個1段。
type Tab = ExpenseTab;
/** 履歴タブの中身。カードの利用明細・PayPay は「ほかの方法」から開く。 */
type HistoryView = "list" | "card" | "paypay";

export default function ExpensePage() {
  const expenseStatus = useExpenseStatus();
  const showToast = useToast();
  const [tab, setTab] = useState<Tab>(EXPENSE_INITIAL_TAB);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | "new" | null>(null);
  const [editingSalary, setEditingSalary] = useState<SalaryEntry | "new" | null>(null);
  const [editingBonus, setEditingBonus] = useState<Transaction | "new" | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [cardCsvImportOpen, setCardCsvImportOpen] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [salaryCsvImportOpen, setSalaryCsvImportOpen] = useState(false);
  const [receiptScanOpen, setReceiptScanOpen] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>("list");
  const [moreMethodsOpen, setMoreMethodsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // アプリアイコン長押しのショートカット(vite.config.ts の manifest.shortcuts)から
  // ?new=expense で来たときは、収支の追加フォームを開いた状態で始める。合わせて
  // 履歴タブへ移す — 保存したあとに何が増えたのかが見える場所で終わるようにする。
  // 開いたら印はURLから消す(残すと、閉じたあとの再読み込みや戻るでまた開く)。
  // ?new=salary はホームの「今月のお金」(給与がまだ無い時)の「給与を登録する」から。
  // ?tab= は、ほかの画面から決まったタブを開くため(ホームの「支出を見る」、まとめて検索の
  // 「サブスクを見る」src/lib/commandPalette.ts など)。すでにお金管理の別のタブを見ている時は
  // 同じ画面のまま(作り直されない)なので、印を見てタブを移す。
  useEffect(() => {
    const resolved = resolveExpenseTabRequest(searchParams.get("new"), searchParams.get("tab"));
    if (!resolved) return;
    setTab(resolved.tab);
    if (resolved.openNew === "expense") setEditingTransaction("new");
    if (resolved.openNew === "salary") setEditingSalary("new");
    const rest = new URLSearchParams(searchParams);
    rest.delete("new");
    rest.delete("tab");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  // レシート読み取りからの下書きは、idを持たないオブジェクトとして開く(新規追加)。
  const isTransactionDraft = typeof editingTransaction === "object" && editingTransaction !== null && !editingTransaction.id;

  const { start, end } = monthRange();
  // 「削除しました・元に戻す」の間は、まだ DB にある収支を隠す(UI/UX 調査メモ 第4弾 A-2、
  // src/lib/deferredDelete.ts)。賞与も収支の1件なので、同じ印で隠す。
  const transactionsResult = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const transactions = useWithoutPendingDeletes("transactions", transactionsResult);
  const salaries = useLiveQuery(() => db.salaries.toArray(), []);
  // 賞与は日付で絞らず全件から拾う。月をまたいで見返すもので、件数も年に数件しかない。
  const bonusesResult = useLiveQuery(() => db.transactions.toArray().then(selectBonuses), []);
  const bonuses = useWithoutPendingDeletes("transactions", bonusesResult);
  const showSalarySkeleton = useDelayedFlag(salaries === undefined);
  const showHistorySkeleton = useDelayedFlag(transactions === undefined);

  // 0件のときだけ、作業面を画面の下まで伸ばす(.is-empty-fill、index.css)。読み込み中
  // (undefined)は伸ばさない — 中身が入るかどうかがまだ分からないため。
  const noSalaries = salaries?.length === 0;
  const noTransactions = transactions?.length === 0;

  return (
    <div className="spatial-page finance-page micro-contrast pb-10 lg:pb-8" style={AREA_ACCENT_STYLE.money}>
      <PageHeader title="お金管理" subtitle={expenseStatus ?? ""} backTo="/" />

      <div className="spatial-page-tabs mx-5 mb-4 lg:mx-8 lg:mb-6 lg:max-w-[840px]">
        <Tabs
          options={[
            { value: "summary", label: "サマリー" },
            { value: "history", label: "履歴" },
            { value: "fixed", label: "固定費" },
            { value: "subs", label: "サブスク" },
            { value: "salary", label: "給与" },
          ]}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setHistoryView("list");
          }}
        />
      </div>

      <div className={`spatial-page-content finance-workspace finance-workspace--${tab} px-5 lg:px-8`}>
        {tab === "fixed" && <FixedCostTab />}
        {tab === "subs" && <SubscriptionTab />}

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
                {/* 賞与は給与とは別の収入。中身は「収入 / ボーナス」の収支なので、
                    履歴タブにも同じ1件として並ぶ(src/lib/bonus.ts)。 */}
                <div className="mt-4">
                  <BonusList
                    bonuses={bonuses ?? []}
                    onAdd={() => setEditingBonus("new")}
                    onEdit={(bonus) => setEditingBonus(bonus)}
                    onDelete={(id) => {
                      void Promise.all([db.transactions.delete(id), deleteProjectTagFor(id)]);
                      showToast("削除しました");
                    }}
                  />
                </div>
              </>
            )}
            <div className="lh-add-row mt-4 flex gap-2">
              <Button className="flex-1 lh-add-end" onClick={() => setEditingSalary("new")}>
                <Plus size={16} aria-hidden="true" /> 給与を追加
              </Button>
              <Button variant="secondary" className="flex-1 lh-add-second" onClick={() => setSalaryCsvImportOpen(true)}>
                CSVから取込
              </Button>
            </div>
          </div>
        )}

        {tab === "history" && historyView === "list" && (
          <div className={`finance-ledger-workspace ${noTransactions ? "is-empty-fill" : ""}`}>
            {showHistorySkeleton ? (
              <ListSkeleton />
            ) : (
              <ExpenseList
                transactions={transactions ?? []}
                onEdit={(t) => setEditingTransaction(t)}
                onDelete={(id) => {
                  // 確認は聞かずに一覧から消し、5秒間「元に戻す」を出す(UI/UX 調査メモ 第4弾 A-2)。
                  // 本当に消すのはお知らせが閉じた時。案件タグもその時に一緒に落とす
                  // (src/lib/undoableDeletes.ts)。残すと年間集計に幽霊の行が出る。
                  const t = transactions?.find((row) => row.id === id);
                  deleteRowWithUndo(
                    "transaction",
                    id,
                    t ? `${quoted(t.store || t.category)}(¥${t.amount.toLocaleString()})を削除しました` : "削除しました",
                  );
                }}
              />
            )}
            {/* 前は4つのボタンを1行に詰めていて、「収支を追/加」と途中で折り返し、
                「CSVで書き出す」は切れていた(UI/UX 調査メモ B-4)。いちばん使う「収支を追加」
                だけを大きく置き、残りは「ほかの方法」にまとめる。 */}
            <div className="finance-history-actions lh-add-row mt-4">
              <Button className="w-full lh-add-end" onClick={() => setEditingTransaction("new")}>
                <Plus size={16} aria-hidden="true" /> 収支を追加
              </Button>
              <Button variant="secondary" className="w-full lh-add-second" onClick={() => setMoreMethodsOpen(true)}>
                ほかの方法(レシート・CSV など)
              </Button>
            </div>
          </div>
        )}

        {tab === "history" && historyView !== "list" && (
          <div className="finance-history-subview">
            <button type="button" className="finance-history-back" onClick={() => setHistoryView("list")}>
              <ArrowLeft size={15} aria-hidden="true" /> 履歴に戻る
            </button>
            {historyView === "card" && <PendingCardChargeList onImport={() => setCardCsvImportOpen(true)} />}
            {historyView === "paypay" && <PayPayImport />}
          </div>
        )}
      </div>

      {/* お金管理の「＋」は、いちばん多い追加の「収支」(UI/UX 調査メモ A-3)。
          前はサマリーに追加の入口が無く、履歴タブの中まで行く必要があった。
          サブスクのタブを見ている時だけは「サブスクを追加」(第2弾 S-8。そこで収支が増えても
          画面に出ないので、押した結果が見えなかった)。 */}
      <PageFab
        onClick={() =>
          tab === "subs" ? openSubscriptionAdd() : tab === "fixed" ? openFixedCostAdd() : setEditingTransaction("new")
        }
        label={tab === "subs" ? "サブスクを追加" : tab === "fixed" ? "固定費を追加" : "収支を追加"}
      >
        <Plus size={24} />
      </PageFab>

      <Sheet open={moreMethodsOpen} onClose={() => setMoreMethodsOpen(false)} title="ほかの方法">
        <div className="finance-more-methods">
          {[
            { label: "レシートから追加", note: "写真から読み取る", icon: ReceiptText, run: () => setReceiptScanOpen(true) },
            { label: "CSVから取込", note: "銀行・カードの明細", icon: FileUp, run: () => setCsvImportOpen(true) },
            { label: "CSVで書き出す", note: "記録をファイルに", icon: Download, run: () => setCsvExportOpen(true) },
            { label: "カードの利用明細", note: "引き落とし前のぶん", icon: CreditCard, run: () => setHistoryView("card") },
            { label: "PayPay", note: "残高と取り込み", icon: Smartphone, run: () => setHistoryView("paypay") },
          ].map(({ label, note, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              className="lh-row finance-more-methods__row"
              onClick={() => {
                setMoreMethodsOpen(false);
                run();
              }}
            >
              <span className="lh-row__icon lh-row__icon--initial" aria-hidden="true">
                <Icon size={17} />
              </span>
              <span className="lh-row__copy">
                <strong>{label}</strong>
                <small>{note}</small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

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

      <Sheet
        open={editingBonus !== null}
        onClose={() => setEditingBonus(null)}
        title={editingBonus === "new" ? "賞与を登録" : "賞与を編集"}
      >
        {editingBonus && (
          <BonusForm
            initial={editingBonus === "new" ? undefined : editingBonus}
            onSaved={() => {
              setEditingBonus(null);
              showToast("保存しました");
            }}
            onCancel={() => setEditingBonus(null)}
          />
        )}
      </Sheet>

      <Sheet
        open={cardCsvImportOpen}
        onClose={() => setCardCsvImportOpen(false)}
        title="カードの利用明細を取込"
      >
        {cardCsvImportOpen && (
          <GenericCsvImport destination="pendingCard" onClose={() => setCardCsvImportOpen(false)} />
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
