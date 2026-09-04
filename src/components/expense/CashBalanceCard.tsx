import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Wallet } from "lucide-react";
import { db, ensureDefaultSettings } from "../../db/schema";
import { viewCashBalance } from "../../lib/cashBalance";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** 財布の現金。PayPay残高と同じで、数えた額を手で入れて起点にし、それ以降に
 * 「現金」で記録した収支を足し引きした推定を出す。 */
export function CashBalanceCard() {
  const showToast = useToast();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  // 現金の収支は起点より後のものだけを見る。日付では絞れない(過去の日付を
  // あとから入れることがある)ので、全件から createdAt で切る。
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);
  const view = viewCashBalance(settings, transactions ?? []);

  async function handleSave() {
    const amount = Number(input);
    if (!Number.isFinite(amount)) {
      showToast("数字で入力してください", "error");
      return;
    }
    const current = settings ?? (await ensureDefaultSettings());
    if (!current.id) return;
    await db.settings.update(current.id, {
      cashBalance: amount,
      cashBalanceUpdatedAt: Date.now(),
    });
    setInput("");
    setEditing(false);
    showToast("財布の現金を更新しました");
  }

  return (
    <Card className="finance-cash-module col-span-2 p-5 lg:col-span-12 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
            <Wallet size={13} />
            財布の現金
          </p>
          <p
            key={view.estimated}
            className={`value-change mt-2 text-2xl font-medium tabular-nums tracking-[-0.03em] lg:text-3xl ${
              view.estimated < 0 ? "text-danger" : "text-slate-800"
            }`}
          >
            {yen(view.estimated)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {view.anchor === 0
              ? "数えた額を入れておくと、以降の現金の支出・収入を足し引きして出します。"
              : view.countedTransactions === 0
                ? `数えた額 ${yen(view.baseline)} のままです。`
                : `数えた額 ${yen(view.baseline)} に、そのあとの現金の収支 ${view.countedTransactions}件を足し引きした推定です。`}
          </p>
        </div>

        {editing ? (
          <div className="flex w-full gap-2 lg:w-auto">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="いま財布にある金額"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
            <Button onClick={handleSave} className="shrink-0">
              更新
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)} className="shrink-0">
              やめる
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setEditing(true)} className="shrink-0">
            数え直す
          </Button>
        )}
      </div>
    </Card>
  );
}
