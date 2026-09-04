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
import {
  buildProjectCsv,
  projectCsvFilename,
  summarizeProjectYear,
  tagsByTransactionId,
  yearsWithProjectRecords,
} from "../../lib/projectTags";
import { DateRangeField } from "../ui/DateField";
import { FormPanel } from "../ui/FormPanel";
import { FormActions } from "../ui/FormActions";
import { SegmentedField } from "../ui/SegmentedField";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  onClose: () => void;
}

type Mode = "detail" | "project";

const MODE_OPTIONS = [
  { value: "detail" as Mode, label: "明細(期間)" },
  { value: "project" as Mode, label: "案件別(年間)" },
];

/** 収支(Transaction)をCSVで書き出す。既存のバックアップ(全データJSON)とは別物で、
 * こちらは表計算ソフトで開いて見返す・確定申告に回すためのもの。
 *
 * 書き出し方は2つ。期間を切った明細と、案件タグごとの年間集計
 * (src/lib/projectTags.ts — 個人開発の確定申告用)。 */
export function TransactionCsvExport({ onClose }: Props) {
  const showToast = useToast();
  const thisMonth = monthRange();
  const [mode, setMode] = useState<Mode>("detail");
  // 既定は今月 — 履歴タブが見せている範囲と同じにしておく。
  const [start, setStart] = useState(thisMonth.start);
  const [end, setEnd] = useState(thisMonth.end);

  const transactions = useLiveQuery(
    () => db.transactions.where("date").between(start, end, true, true).toArray(),
    [start, end],
  );
  const count = transactions?.length ?? 0;

  // 案件別は年でまとめるので、期間で絞った上の一覧とは別に全件を読む。
  const allTransactions = useLiveQuery(() => db.transactions.toArray(), []);
  const tagRows = useLiveQuery(() => db.transactionProjectTags.toArray(), []);
  const tags = tagsByTransactionId(tagRows ?? []);
  const years = yearsWithProjectRecords(allTransactions ?? [], tags);
  const [year, setYear] = useState<number | null>(null);
  // 記録のある年のうち、いちばん新しい年を既定にする。
  const selectedYear = year ?? years[0] ?? new Date().getFullYear();
  const summaries = summarizeProjectYear(allTransactions ?? [], tags, selectedYear);

  function handleExportDetail() {
    const rows = filterTransactionsForExport(transactions ?? [], start, end);
    if (rows.length === 0) {
      showToast("この期間に記録がありません", "error");
      return;
    }
    downloadTransactionCsv(buildTransactionCsv(rows), transactionCsvFilename(start, end));
    showToast(`${rows.length}件を書き出しました`);
    onClose();
  }

  function handleExportProject() {
    if (summaries.length === 0) {
      showToast("この年に案件タグの付いた記録がありません", "error");
      return;
    }
    downloadTransactionCsv(buildProjectCsv(summaries), projectCsvFilename(selectedYear));
    showToast(`${summaries.length}件の案件を書き出しました`);
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <FormPanel caption="何を書き出すか">
        <SegmentedField label="書き出し方" value={mode} options={MODE_OPTIONS} onChange={setMode} />
      </FormPanel>

      {mode === "detail" ? (
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
      ) : (
        <FormPanel caption="どの年">
          {years.length === 0 ? (
            <p className="text-xs text-slate-500">
              案件タグの付いた記録がまだありません。支出・収入の「案件」欄に名前を入れると、ここでまとめて書き出せます。
            </p>
          ) : (
            <>
              <Select label="年" value={String(selectedYear)} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}年(1月〜12月)
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                {selectedYear}年の案件 {summaries.length}件を、案件別→月別にまとめて書き出します。
                案件・月・収入・支出・差引の5列で、案件ごとに合計の行が入ります。
              </p>
              {/* タグは同期していない(端末の中だけ)ので、集計が抜けないよう断っておく。 */}
              <p className="text-xs text-slate-400">
                案件タグはこの端末にだけ保存されます。別の端末で付けたぶんはここには出ません。
              </p>
            </>
          )}
        </FormPanel>
      )}

      <FormActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        {mode === "detail" ? (
          <Button type="button" onClick={handleExportDetail} disabled={transactions === undefined}>
            CSVで書き出す
          </Button>
        ) : (
          <Button type="button" onClick={handleExportProject} disabled={allTransactions === undefined || years.length === 0}>
            CSVで書き出す
          </Button>
        )}
      </FormActions>
    </div>
  );
}
