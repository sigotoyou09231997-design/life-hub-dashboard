import { useLiveQuery } from "dexie-react-hooks";
import { CreditCard, Trash2 } from "lucide-react";
import { db } from "../../db/schema";
import type { PendingCardCharge } from "../../types";
import { formatCompactDate } from "../../lib/date";
import { settledExternalId, unsettledCharges } from "../../lib/pendingCardCharges";
import { EXPENSE_CATEGORIES } from "../../lib/categories";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ListRow } from "../ui/ListRow";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/ToastProvider";
import { useConfirm } from "../ui/ConfirmProvider";

interface Props {
  onImport: () => void;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/**
 * カードの「使ったが、まだ引き落とされていない」利用の一覧。
 *
 * 確定したかどうかは行に印を持たず、支出(Transaction)と突き合わせて毎回決める
 * (src/lib/pendingCardCharges.ts)。だから支出の側を消せば、その利用はまた
 * 未確定に戻る。
 */
export function PendingCardChargeList({ onImport }: Props) {
  const showToast = useToast();
  const confirm = useConfirm();
  const charges = useLiveQuery(() => db.pendingCardCharges.toArray(), []);
  const transactions = useLiveQuery(() => db.transactions.toArray(), []);

  const all = charges ?? [];
  const unsettled = unsettledCharges(all, transactions ?? []);
  const settledCount = all.length - unsettled.length;
  const unsettledTotalAmount = unsettled.reduce((sum, charge) => sum + charge.amount, 0);

  /** 未確定の利用を、そのまま支出として記録する。印(externalId)を付けるので、
   * 記録したあとはこの一覧から外れる。 */
  async function handleSettle(charge: PendingCardCharge) {
    await db.transactions.add({
      type: "expense",
      amount: charge.amount,
      category: EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1],
      method: "クレジットカード",
      store: charge.store,
      memo: charge.memo ?? "カード明細から",
      date: charge.date,
      isFixed: false,
      externalId: settledExternalId(charge.externalId),
      createdAt: Date.now(),
    });
    showToast("支出に記録しました");
  }

  async function handleDelete(charge: PendingCardCharge) {
    if (!charge.id) return;
    const ok = await confirm({
      title: `「${charge.store || "カード利用"}」(${yen(charge.amount)})を一覧から消しますか?`,
      confirmLabel: "一覧から消す",
    });
    if (!ok) return;
    await db.pendingCardCharges.delete(charge.id);
    showToast("削除しました");
  }

  return (
    <div className="space-y-3">
      <Card className="p-5">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">まだ引き落とされていない利用</p>
        <p className="mt-2 text-3xl font-medium tabular-nums tracking-[-0.04em] text-navy">
          {yen(unsettledTotalAmount)}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          この金額は「使えるお金」から先に引いています。
          {settledCount > 0 && ` すでに支出として記録された ${settledCount} 件は除いています。`}
        </p>
        <Button className="mt-4 w-fit" variant="secondary" onClick={onImport}>
          利用明細CSVを取り込む
        </Button>
      </Card>

      {unsettled.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={all.length === 0 ? "取り込んだ利用はまだありません" : "未確定の利用はありません"}
          description={
            all.length === 0
              ? "カード会社の利用明細CSVを取り込むと、引き落とし前の利用も残額に反映されます。"
              : "取り込んだ利用はすべて支出として記録済みです。"
          }
        />
      ) : (
        <div className="space-y-2">
          {unsettled.map((charge) => (
            <ListRow key={charge.id} className="flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{charge.store || "カード利用"}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatCompactDate(charge.date)}
                  {charge.memo && ` ・ ${charge.memo}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-slate-900">{yen(charge.amount)}</span>
                <Button variant="secondary" onClick={() => handleSettle(charge)}>
                  支出にする
                </Button>
                <button
                  type="button"
                  onClick={() => handleDelete(charge)}
                  aria-label="削除"
                  className="rounded-full p-1.5 text-slate-300 transition-colors active:bg-red-50 active:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </ListRow>
          ))}
        </div>
      )}

      {settledCount > 0 && (
        <p className="text-[11px] text-slate-400">
          支出として記録済みの {settledCount} 件は、二重に数えないためこの一覧から外しています。
          利用日と金額が同じ支出があるものも、記録済みとして扱います。
        </p>
      )}
    </div>
  );
}
