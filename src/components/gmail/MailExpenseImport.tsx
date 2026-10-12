import { useEffect, useState } from "react";
import { db } from "../../db/schema";
import type { SyncedEmail } from "../../types";
import { toExpenseSuggestion } from "../../lib/expenseMailSuggestion";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_BUTTON_LABELS } from "../../lib/categories";
import { orderCategoriesByUsage } from "../../lib/categoryUsage";
import { todayStr } from "../../lib/date";
import { Sheet } from "../ui/Sheet";
import { Input, AmountInput } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/ToastProvider";
import { Receipt } from "lucide-react";

interface Props {
  email: SyncedEmail;
  open: boolean;
  onClose: () => void;
}

/** 同じメールから2回登録しないための印。取り込みの重複よけ(PayPay CSVの
 * externalId と同じ考え方)で、Transaction.externalId に入れる。 */
/** 支払い方法のボタン。値は今までのプルダウンと同じ、名前は収支の入力(ExpenseForm)と同じ短い形。 */
const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_BUTTON_LABELS[m] ?? m }));

export function expenseExternalId(gmailMessageId: string): string {
  return `gmail-expense:${gmailMessageId}`;
}

/**
 * 注文確認・領収書メールから支出を1件作るシート。
 *
 * 読み取りは端末の中の文字合わせだけ(src/lib/expenseMailSuggestion.ts) — AIは呼ばない。
 * 読み違いは必ずあるので、保存の前に本人が中身を直せる形にしてある。
 */
export function MailExpenseImport({ email, open, onClose }: Props) {
  const showToast = useToast();
  const suggestion = toExpenseSuggestion(email);

  const [amount, setAmount] = useState("");
  const [store, setStore] = useState("");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [method, setMethod] = useState(PAYMENT_METHODS[1]);
  const [saving, setSaving] = useState(false);
  const [alreadySaved, setAlreadySaved] = useState(false);
  // カテゴリのボタンの並び。収支の入力(ExpenseForm)と同じく最近よく使う順(src/lib/categoryUsage.ts)で、
  // 開いた時に1回だけ決める(開いているあいだに並びが動くと、押そうとしたボタンが逃げる)。
  // 既定で選ぶカテゴリは今までどおり「食費」のまま — 並びだけ変える。
  const [categoryOrder, setCategoryOrder] = useState<string[]>(EXPENSE_CATEGORIES);

  // 開くたびに読み取り直した値へ戻す。前に開いたメールの値が残らないようにする。
  useEffect(() => {
    if (!open || !suggestion) return;
    setAmount(String(suggestion.amount));
    setStore(suggestion.store);
    setDate(suggestion.date);
    setCategory(EXPENSE_CATEGORIES[0]);
    setMethod(PAYMENT_METHODS[1]);
    // 同じメールから既に登録していないか見る。登録済みなら保存させない。
    void db.transactions
      .where("externalId")
      .equals(expenseExternalId(email.gmailMessageId))
      .count()
      .then((count) => setAlreadySaved(count > 0));
    void db.transactions
      .toArray()
      .then((rows) => setCategoryOrder(orderCategoriesByUsage(EXPENSE_CATEGORIES, rows, "expense", todayStr())));
    // suggestion は毎描画で作り直されるので、開閉とメールの入れ替わりだけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, email.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0 || !date) return;

    setSaving(true);
    await db.transactions.add({
      type: "expense",
      amount: numericAmount,
      category,
      method,
      store: store.trim() || undefined,
      memo: `メール「${email.subject}」から`,
      date,
      isFixed: false,
      externalId: expenseExternalId(email.gmailMessageId),
      createdAt: Date.now(),
    });
    // 登録したメールは、以後この候補には出さない。
    if (email.id) await db.syncedEmails.update(email.id, { expenseSuggestionDismissedAt: Date.now() });
    setSaving(false);
    showToast("支出に追加しました");
    onClose();
  }

  async function handleDismiss() {
    if (email.id) await db.syncedEmails.update(email.id, { expenseSuggestionDismissedAt: Date.now() });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="支出に追加">
      {!suggestion ? (
        <EmptyState
          icon={Receipt}
          title="金額が読み取れませんでした"
          description="お金管理の画面から手で追加してください。"
        />
      ) : alreadySaved ? (
        <EmptyState
          icon={Receipt}
          title="このメールからは登録済みです"
          description="同じ支出を二重に数えないよう、もう一度は追加できません。"
        />
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormPanel caption="メールから読み取った内容">
            <AmountInput
              label="金額"
              hint="読み違いがあれば直してください。"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              min={1}
              autoFocus
            />
            <Input label="店名" optional value={store} onChange={(e) => setStore(e.target.value)} />
            <DateField label="日付" value={date} onChange={setDate} />
          </FormPanel>

          <FormPanel caption="分類">
            {/* プルダウンにしない。iPhone ではシートの中のプルダウンを押すとキーボード(金額の欄で開いている)が
                閉じてシートが動き、選択肢が欄から離れた所に出て、押したつもりが外れる(2026-10-12。
                2026-10-11の持ち物、収支の入力と同じ直し方)。3列も収支の入力にそろえる。 */}
            <SegmentedField
              label="カテゴリ"
              value={category}
              options={categoryOrder.map((c) => ({ value: c, label: c }))}
              onChange={setCategory}
              columns={3}
              separate
            />
            <SegmentedField
              label="支払い方法"
              value={method}
              options={METHOD_OPTIONS}
              onChange={setMethod}
              columns={3}
              separate
            />
          </FormPanel>

          <FormActions>
            <Button type="button" variant="secondary" onClick={handleDismiss}>
              このメールは出さない
            </Button>
            <Button type="submit" disabled={saving}>
              支出に追加
            </Button>
          </FormActions>
        </form>
      )}
    </Sheet>
  );
}
