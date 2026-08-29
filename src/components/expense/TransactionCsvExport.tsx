import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import { monthRange } from "../../lib/date";
import {
  buildTransactionCsv,
  downloadTransactionCsv,
  filterTransactionsForExport,
  transactionCsvFilename,
} from "../../lib/transactionCsv";
import { DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  onClose: () => void;
}

/** 収支(Transaction)をCSVで書き出す。既存のバックアップ(全データJSON)とは別物で、
 * こちらは表計算ソフトで開いて見返す・確定申告に回すためのもの。 */
export function TransactionCsvExport({ onClose }: Props) {
  const showToast = useToast();
  const thisMonth = monthRange();
  // 既定は今月 — 履歴タブが見せている範囲と同じにしておく。
  const [start, setStart] = useState(thisMonth.start);
  const [end, setEnd] = useState(thisMonth.end);

  const transactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const count = transactions?.length ?? 0;

  function handleExport() {
    const rows = filterTransactionsForExport(transactions ?? [], start, end);
    if (rows.length === 0) {
      showToast("この期間に記録がありません", "error");
      return;
    }
    downloadTransactionCsv(buildTransactionCsv(rows), transactionCsvFilename(start, end));
    showToast(`${rows.length}件を書き出しました`);
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <FormPanel caption="いつからいつまで">
        <DateRangeField
          label="期間"
          start={start}
          end={end}
          onChangeStart={setStart}
          onChangeEnd={setEnd}
          summary={false}
        />
        <p className="text-xs text-slate-500">
          この期間の収支 {count}件を書き出します。日付・種別・カテゴリ・金額・支払い方法・店名・メモ・固定費の8列です。
        </p>
      </FormPanel>

      <FormActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button type="button" onClick={handleExport} disabled={transactions === undefined}>
          CSVで書き出す
        </Button>
      </FormActions>
    </div>
  );
}
