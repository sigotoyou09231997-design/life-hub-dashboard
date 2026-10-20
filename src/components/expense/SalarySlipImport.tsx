import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/schema";
import type { SalaryEntry } from "../../types";
import { parsePayslipBoxes, type ParsedPayslip } from "../../lib/payslipLayout";
import { readPdfTextBoxes } from "../../lib/payslipPdf";
import { todayStr } from "../../lib/date";
import { Button } from "../ui/Button";
import { DateField } from "../ui/DateField";
import { useToast } from "../ui/ToastProvider";
import { SalaryCsvImport } from "./SalaryCsvImport";

interface Props {
  onClose: () => void;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${year}年${Number(m)}月`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** 明細に支給日が無い時の給料日: 明細の月 ＋ いま登録している給与の給料日(無ければ25日)。 */
function guessPaidOn(slip: ParsedPayslip, salaries: SalaryEntry[]): string {
  if (slip.paidOn) return slip.paidOn;
  const latest = [...salaries].sort((a, b) => b.month.localeCompare(a.month))[0];
  const day = String(latest?.payday ?? 25).padStart(2, "0");
  const month = slip.slipMonth ?? todayStr().slice(0, 7);
  return `${month}-${day}`;
}

/**
 * 給与明細から給与を取り込む(2026-10-20、本人「このタイプの給与明細を読み込めるようにして」)。
 * PDF(見出しの下に金額が並ぶ表の明細)は、手取り・総支給・控除の内訳を読み取って、確かめてから登録する。
 * CSV は今までの取り込み(列を選ぶ。SalaryCsvImport)へ渡す。
 * 同じ月の給与がもうあれば、増やさずに置き換える(手で入れていた給与を、明細の正しい数字にする)。
 */
export function SalarySlipImport({ onClose }: Props) {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const salaries = useLiveQuery(() => db.salaries.toArray(), []);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [slip, setSlip] = useState<ParsedPayslip | null>(null);
  const [paidOn, setPaidOn] = useState("");
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (csvFile) return <SalaryCsvImport onClose={onClose} initialFile={csvFile} />;

  async function handleFile(file: File) {
    setError(null);
    if (!isPdf(file)) {
      setCsvFile(file);
      return;
    }
    setReading(true);
    try {
      const parsed = parsePayslipBoxes(await readPdfTextBoxes(file), file.name);
      if (!parsed) {
        setError("この明細からは手取り（差引支給額）を読み取れませんでした。給与明細のCSVで取り込むか、「給与を追加」から入れてください。");
        return;
      }
      setSlip(parsed);
      setPaidOn(guessPaidOn(parsed, salaries ?? []));
    } catch (err) {
      console.error("[payslip] failed to read pdf:", err);
      setError("PDFを読み込めませんでした。パスワードの付いたPDFや、写真をPDFにしたもの（文字が入っていないもの）は読めません。");
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!slip || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return;
    setSaving(true);
    try {
      const month = paidOn.slice(0, 7);
      const fields = {
        month,
        payday: Number(paidOn.slice(8, 10)),
        amount: slip.net,
        grossAmount: slip.gross ?? undefined,
        deductions: slip.deductions,
      };
      const existing = (salaries ?? []).find((salary) => salary.month === month);
      if (existing?.id) await db.salaries.update(existing.id, fields);
      else await db.salaries.add({ ...fields, createdAt: Date.now() });
      showToast(existing ? `${monthLabel(month)}の給与を明細の内容にしました` : `${monthLabel(month)}の給与を登録しました`);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!slip) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          会社の給与明細（PDF）か、給与明細のCSVを選んでください。PDFは、見出しの下に金額が並ぶ表の形の明細から、手取り・総支給・控除の内訳を読み取ります。
        </p>
        <Button variant="secondary" className="w-full" disabled={reading} onClick={() => fileInputRef.current?.click()}>
          {reading ? "読み取っています…" : "ファイルを選ぶ"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,application/pdf,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const month = paidOn.slice(0, 7);
  const existing = (salaries ?? []).find((salary) => salary.month === month);

  return (
    <div className="slip-preview space-y-4">
      <p className="slip-preview__title">{slip.slipMonth ? `${monthLabel(slip.slipMonth)}分の給与明細` : "給与明細"}</p>
      <dl className="slip-preview__table">
        {slip.gross != null && (
          <div>
            <dt>総支給額</dt>
            <dd>{yen(slip.gross)}</dd>
          </div>
        )}
        {slip.deductionTotal != null && (
          <div>
            <dt>控除合計</dt>
            <dd>−{yen(slip.deductionTotal)}</dd>
          </div>
        )}
        <div className="is-total">
          <dt>差引支給額（手取り）</dt>
          <dd>{yen(slip.net)}</dd>
        </div>
      </dl>
      {slip.balanced === false && (
        <p className="slip-preview__warn" role="note">
          総支給 − 控除合計 が手取りと合いません。読み取り違いかもしれないので、明細と見比べてください。
        </p>
      )}
      {slip.deductions.length > 0 && (
        <div>
          <p className="slip-preview__caption">控除の内訳</p>
          <ul className="slip-preview__list">
            {slip.deductions.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <span>{yen(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <DateField
        label="給料日（振り込まれた日）"
        hint={slip.paidOn ? "明細のファイル名・中身の日付から入れました。違う時は直してください。" : "明細に支給日が無かったので、いつもの給料日で入れました。違う時は直してください。"}
        value={paidOn}
        onChange={setPaidOn}
      />
      <p className="slip-preview__note">
        使えるお金は、手取り（差引支給額）から、固定費・サブスク・使った額を引いて出します。
        {existing ? ` ${monthLabel(month)}の給与はもう登録されています（${yen(existing.amount)}）。登録すると、明細の内容で置き換えます。` : ""}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={() => setSlip(null)}>
          選び直す
        </Button>
        <Button type="button" className="flex-1" disabled={saving || !paidOn} onClick={() => void handleSave()}>
          {existing ? "置き換える" : "登録する"}
        </Button>
      </div>
    </div>
  );
}
