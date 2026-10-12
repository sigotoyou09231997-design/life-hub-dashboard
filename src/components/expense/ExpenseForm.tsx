import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { Transaction, TransactionType } from "../../types";
import { todayStr } from "../../lib/date";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_BUTTON_LABELS,
} from "../../lib/categories";
import { orderCategoriesByUsage } from "../../lib/categoryUsage";
import { collectStoreSamples, guessCategoryFromStore } from "../../lib/storeCategory";
import { knownProjectTags, loadProjectTag, saveProjectTag } from "../../lib/projectTags";
import { CalendarDays, ChevronDown, Store, Wallet } from "lucide-react";
import { Input, Textarea, AmountInput } from "../ui/Input";
import { SegmentedField } from "../ui/SegmentedField";
import { SwitchField } from "../ui/SwitchField";
import { DateField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";

interface Props {
  initial?: Transaction;
  defaultType?: TransactionType;
  /** 保存ボタンの文言。レシート読み取りからの確認画面など、initialはあっても
   * 「新規追加」扱いにしたい呼び出し元向け(既定はinitialの有無で決める今までどおり)。 */
  submitLabel?: string;
  onSaved: () => void;
  onCancel: () => void;
}

/** 一覧に無い値(取り込みで入った独自のカテゴリ・支払い方法)を開いたときは、末尾に1つ足して
 * 選んだ状態で見せる。足さないと、どれも選ばれていないように見えるのに保存すると元の値が残る。 */
function withCurrent(options: readonly string[], current: string): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options];
}

function defaultCategoriesFor(type: TransactionType): readonly string[] {
  return type === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
}

export function ExpenseForm({ initial, defaultType = "expense", submitLabel, onSaved, onCancel }: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? defaultType);
  // amount: 0(レシート読み取りで金額が読めなかった時の仮値)は未入力と同じ扱いにする —
  // 「0」が入ったまま出すより、空欄で金額の入力を促す方がよい。
  const [amount, setAmount] = useState(initial?.amount ? initial.amount.toString() : "");
  // 自分で選んだカテゴリ。null のあいだは、店名からの推測 → よく使う順の先頭、の順で決める。
  // 編集中の記録・レシートの下書きは、既にカテゴリが入っているので最初から「選んだ」扱いにして
  // 推測で上書きしない。
  const [pickedCategory, setPickedCategory] = useState<string | null>(initial?.category ?? null);
  const [method, setMethod] = useState(initial?.method ?? PAYMENT_METHODS[0]);
  const [store, setStore] = useState(initial?.store ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [date, setDate] = useState(initial?.date ?? todayStr());
  const [isFixed, setIsFixed] = useState(initial?.isFixed ?? false);
  const [projectTag, setProjectTag] = useState("");
  // 案件・メモ・固定費は毎回は使わないので「詳しく」に畳む。使っている記録を開いたときだけ
  // 最初から開く(畳んだままだと、入っている値が見えないまま保存してしまう)。
  const [moreOpen, setMoreOpen] = useState(() => Boolean(initial?.memo?.trim() || initial?.isFixed));
  const [saving, setSaving] = useState(false);

  // 案件タグは収支の行と別のテーブルにあるので、開いたときに読み直す
  // (src/lib/projectTags.ts)。
  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    loadProjectTag(initialId).then((tag) => {
      if (!alive) return;
      setProjectTag(tag);
      if (tag) setMoreOpen(true);
    });
    return () => {
      alive = false;
    };
  }, [initialId]);

  // 今までに使った案件名。入力欄の候補に出す(決まった一覧は持たない)。
  const projectTagRows = useLiveQuery(() => db.transactionProjectTags.toArray(), []);
  const tagSuggestions = knownProjectTags(projectTagRows ?? []);

  // 店名からカテゴリを推測する材料と、カテゴリをよく使う順に並べる材料。過去の収支は
  // そう多くないので全件から作る。
  const pastTransactions = useLiveQuery(() => db.transactions.toArray(), []);
  const storeSamples = collectStoreSamples(pastTransactions ?? []);
  const guess = type === "expense" ? guessCategoryFromStore(storeSamples, store) : null;

  // カテゴリのボタンの並び。開いた時点の記録で1回だけ決めて、開いているあいだは動かさない
  // (同期で記録が届くたびに並びが変わると、押そうとしたボタンが逃げる)。
  const [categoryOrder, setCategoryOrder] = useState<Record<TransactionType, string[]> | null>(null);
  useEffect(() => {
    if (categoryOrder || !pastTransactions) return;
    const today = todayStr();
    setCategoryOrder({
      expense: orderCategoriesByUsage(EXPENSE_CATEGORIES, pastTransactions, "expense", today),
      income: orderCategoriesByUsage(INCOME_CATEGORIES, pastTransactions, "income", today),
    });
  }, [pastTransactions, categoryOrder]);

  const orderedCategories = categoryOrder?.[type] ?? defaultCategoriesFor(type);
  const category = pickedCategory ?? guess?.category ?? orderedCategories[0];
  const categoryOptions = withCurrent(orderedCategories, category);
  const methodOptions = withCurrent(PAYMENT_METHODS, method);

  function handleTypeChange(next: TransactionType) {
    if (next === type) return;
    setType(next);
    // 収入と支出でカテゴリの一覧が違うので、選び直しにする。
    setPickedCategory(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return;

    setSaving(true);
    const record: Transaction = {
      type,
      amount: numericAmount,
      category,
      method: type === "expense" ? method : undefined,
      store: type === "expense" ? store : undefined,
      memo,
      date,
      isFixed: type === "expense" ? isFixed : false,
      createdAt: initial?.createdAt ?? Date.now(),
    };

    // 新しい記録にはまだidが無く、案件タグの貼り先を決められない。保存して得た
    // idに向けて、そのあとで書く(src/lib/projectTags.ts)。
    let transactionId: string;
    if (initial?.id) {
      transactionId = initial.id;
      await db.transactions.update(transactionId, record);
    } else {
      transactionId = String(await db.transactions.add(record));
    }
    await saveProjectTag(transactionId, projectTag);
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormPanel caption="いくら" icon={Wallet}>
        <SegmentedField
          label="種類"
          value={type}
          options={[
            { value: "expense" as TransactionType, label: "支出" },
            { value: "income" as TransactionType, label: "収入" },
          ]}
          onChange={handleTypeChange}
        />
        <AmountInput
          label="金額"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          min={1}
          autoFocus
        />
      </FormPanel>

      {/* 店舗をカテゴリより前に置く。店名を打った時点で、過去に同じ店で選んだカテゴリが
          下のボタンに入るので、たいていはカテゴリを押さずに済む。 */}
      <FormPanel caption={type === "expense" ? "どこで・何に" : "何の収入"} icon={Store}>
        {type === "expense" && (
          <div>
            <Input
              label="店舗"
              optional
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="例: いつものスーパー"
            />
            {/* 過去に同じ店で選んだカテゴリ。まだ自分で選んでいなければ下のカテゴリに
                入れてあり、選んだあとは押して入れ替えられるようにする。 */}
            {guess && (
              <div className="-mt-1.5 px-[0.9rem] pb-3">
                {guess.category === category ? (
                  <p className="text-xs text-slate-500">
                    「{guess.matchedStore}」の過去{guess.matchedCount}件から
                    <span className="font-semibold text-slate-700">{guess.category}</span>にしています
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickedCategory(guess.category)}
                    className="text-left text-xs font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    「{guess.matchedStore}」では{guess.category}が多いです。{guess.category}にする
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* 最近よく使う順(src/lib/categoryUsage.ts)。iPhone ではシートの中のプルダウンが
            離れた所に開いて編集画面ごと消えることがあるので、少ない選択肢はボタンにする。 */}
        <SegmentedField
          label="カテゴリ"
          value={category}
          options={categoryOptions.map((c) => ({ value: c, label: c }))}
          onChange={setPickedCategory}
          columns={3}
          separate
        />
        {type === "expense" && (
          <SegmentedField
            label="支払い方法"
            value={method}
            options={methodOptions.map((m) => ({ value: m, label: PAYMENT_METHOD_BUTTON_LABELS[m] ?? m }))}
            onChange={setMethod}
            columns={3}
            separate
          />
        )}
      </FormPanel>

      <FormPanel caption="いつ" icon={CalendarDays}>
        <DateField label="日付" value={date} onChange={setDate} />
      </FormPanel>

      <FormPanel>
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="expense-form-more"
          onClick={() => setMoreOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-[0.9rem] py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-700">詳しく</span>
            <span className="block text-xs text-slate-500">
              {type === "expense" ? "案件・メモ・固定費の支払い" : "案件・メモ"}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-500 transition-transform ${moreOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {moreOpen && (
          <div id="expense-form-more" className="form-panel__body">
            {/* 個人開発の案件ごとの収支を、年末にまとめて書き出すための印
                (src/lib/projectTags.ts)。付けたものだけが案件別の集計に出る。 */}
            <Input
              label="案件"
              optional
              value={projectTag}
              onChange={(e) => setProjectTag(e.target.value)}
              placeholder="例: Aサイト制作"
              list="project-tag-options"
              hint="付けた収支だけ、年間の案件別エクスポートに出ます。"
            />
            <datalist id="project-tag-options">
              {tagSuggestions.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            <Textarea label="メモ" optional value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
            {type === "expense" && (
              <SwitchField
                label="固定費の支払いとして記録する"
                hint="使えるお金の計算から外します。"
                checked={isFixed}
                onChange={setIsFixed}
              />
            )}
          </div>
        )}
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit" disabled={saving}>
          {submitLabel ?? (initial ? "変更を保存" : "記録する")}
        </Button>
      </FormActions>
    </form>
  );
}
