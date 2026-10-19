import type { PayPayImportOutcome } from "../../lib/paypayImport";
import type { PayPayHouseholdDraft } from "../../lib/paypayCsv";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** YYYY-MM-DD → 10/20 */
function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function DraftRows({ drafts }: { drafts: PayPayHouseholdDraft[] }) {
  return (
    <ul className="paypay-result__rows">
      {drafts.map(({ row, entry }) => (
        <li key={row.externalId} className="paypay-result__row">
          <span className="paypay-result__date">{shortDate(row.date)}</span>
          <span className="paypay-result__store">{entry.store || entry.memo}</span>
          <span className="paypay-result__amount">
            {entry.type === "income" ? "+" : ""}
            {yen(entry.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * PayPay の CSV を取り込んだ結果。何件入ったかに加えて、「使えるお金」から引かれたかを書く
 * (取り込んでも使えるお金が変わらない時に、給与が未登録・期間の前の日付・すべて取り込み済み、の
 * どれなのかが画面で分かるように)。
 */
export function PayPayImportResult({ outcome }: { outcome: PayPayImportOutcome }) {
  const { added, duplicates, internal, similarToManual, budget } = outcome;
  const addedExpenses = added.filter((d) => d.entry.type === "expense").length;
  return (
    <div className="paypay-result mt-4 space-y-3 rounded-xl bg-white/40 p-3.5 text-sm text-slate-600" role="status">
      {added.length > 0 ? (
        <>
          <p className="font-semibold text-slate-900">お金管理に {added.length}件 入れました</p>
          <DraftRows drafts={added} />
        </>
      ) : duplicates > 0 ? (
        <p className="font-semibold text-slate-900">このファイルの取引は、すべて取り込み済みです</p>
      ) : (
        <p className="font-semibold text-slate-900">お金管理に入れる取引はありませんでした</p>
      )}

      {addedExpenses > 0 && budget.periodStart && budget.hasSalary && budget.inPeriodCount > 0 && (
        <p>
          今の給料の期間（{shortDate(budget.periodStart)}から）の支出として、使えるお金から{" "}
          <strong className="text-slate-900">{yen(budget.inPeriodTotal)}</strong> 引きました。
        </p>
      )}
      {addedExpenses > 0 && budget.beforePeriodCount > 0 && (
        <p>{budget.beforePeriodCount}件は今の給料の期間より前の日付なので、使えるお金には入りません。</p>
      )}
      {addedExpenses > 0 && !budget.hasSalary && (
        <p>
          今の給料の期間の給与がまだ登録されていません。「給与」に登録すると、そこから引かれます。
        </p>
      )}

      {similarToManual.length > 0 && (
        <div className="space-y-1.5">
          <p>手で入れた記録に、同じ日・同じ金額のものが {similarToManual.length}件 あります。二重になっていたら、どちらかを消してください。</p>
          <DraftRows drafts={similarToManual} />
        </div>
      )}

      <div className="space-y-0.5 text-xs text-slate-500">
        {duplicates > 0 && added.length > 0 && <p>すでに入っていたので入れなかった取引: {duplicates}件</p>}
        {internal > 0 && <p>チャージ・口座への送金など、PayPay の中の移動（お金管理には入れず、残高にだけ反映）: {internal}件</p>}
      </div>
    </div>
  );
}
