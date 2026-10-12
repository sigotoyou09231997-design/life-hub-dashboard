import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { deleteProjectTagFor } from "../../lib/projectTags";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../../lib/categories";
import { orderCategoriesByUsage } from "../../lib/categoryUsage";
import { todayStr } from "../../lib/date";
import { openQuickAdd } from "../layout/AddChooser";
import { useToast } from "../ui/ToastProvider";
import type { Transaction } from "../../types";

/** カテゴリのボタンに並べる数。残りは「くわしく」(収支を追加の画面)で選ぶ。 */
const VISIBLE_CATEGORIES = 4;

/** 入力された金額を数にする。カンマ・全角の数字・円記号を許す。0以下・数でないものは null。 */
export function parseAmountInput(raw: string): number | null {
  const normalized = raw
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[,，¥￥円\s]/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 今月の記録が0件の時、ホームの黒いカードの中で、その場で支出を1件入れる(UI/UX 調査メモ 第5弾 A-3、2026-10-13)。
 *
 * 「¥0」が主役だと、最初の1件を入れたくならない。金額を打つ → カテゴリを選ぶ → 「記録する」だけ。
 * 保存は、「収支を追加」(src/components/expense/ExpenseForm.tsx)と同じ項目・同じ書き込み(db.transactions.add)。
 * 入れると、カードはいつもの「今月の支出」の表示に切り替わり、金額が数え上がる(CountingAmount)。
 * 記録のあとは5秒間「元に戻す」が出て、押すとその1件を消して、この入力に戻る。
 * 店名・メモ・支払い方法などは、「くわしく」から、いつもの入力画面で。
 */
export function InlineExpenseEntry() {
  const showToast = useToast();
  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // カテゴリは、最近よく使う順(収支を追加と同じ並び)。記録がまだ無ければ、既定の並び。
  const pastTransactions = useLiveQuery(() => db.transactions.toArray(), []);
  const ordered = orderCategoriesByUsage(EXPENSE_CATEGORIES, pastTransactions ?? [], "expense", todayStr());
  const categories = ordered.slice(0, VISIBLE_CATEGORIES);
  const category = picked ?? ordered[0];
  const numericAmount = parseAmountInput(amount);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (numericAmount === null || saving) return;
    setSaving(true);
    const record: Transaction = {
      type: "expense",
      amount: numericAmount,
      category,
      method: PAYMENT_METHODS[0],
      store: "",
      memo: "",
      date: todayStr(),
      isFixed: false,
      createdAt: Date.now(),
    };
    try {
      const id = String(await db.transactions.add(record));
      setAmount("");
      setPicked(null);
      showToast("記録しました", {
        action: {
          label: "元に戻す",
          onClick: () => Promise.all([db.transactions.delete(id), deleteProjectTagFor(id)]),
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="lh-inline-entry" onSubmit={handleSubmit}>
      <span className="lh-money__label">今月の支出</span>
      <label className="lh-inline-entry__amount">
        <small aria-hidden="true">¥</small>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          aria-label="金額(円)"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <p className="warm-amount__note">今月はまだ記録がありません。最初の1件を入れてみましょう</p>
      <div className="lh-inline-entry__cats" role="group" aria-label="カテゴリ">
        {categories.map((name) => (
          <button
            key={name}
            type="button"
            className="lh-inline-entry__cat"
            aria-pressed={name === category}
            onClick={() => setPicked(name)}
          >
            {name}
          </button>
        ))}
        <button type="button" className="lh-inline-entry__more" onClick={() => openQuickAdd("expense")}>
          くわしく
        </button>
      </div>
      <div className="lh-money__actions">
        <button type="submit" className="lh-money__cta" disabled={numericAmount === null || saving}>
          記録する
        </button>
        <Link to="/records/expense?new=salary" className="warm-card__foot">
          給与を登録する
        </Link>
      </div>
    </form>
  );
}
