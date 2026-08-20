import { useMemo, useRef, useState } from "react";
import { db } from "../../db/schema";
import { parseCsvRows, decodeCsvFileAuto, decodeCsvFileAs, buildPreview, type CsvEncoding } from "../../lib/csv";
import { mapCsvRowsToSalaries, type SalaryColumnMapping } from "../../lib/salaryCsv";
import { Card } from "../ui/Card";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface Props {
  onClose: () => void;
}

type Step = "upload" | "mapping" | "result";

const ENCODING_LABEL: Record<CsvEncoding, string> = { "utf-8": "UTF-8", shift_jis: "Shift-JIS" };

const DATE_KEYWORDS = ["支給日", "支払日", "対象年月", "支給年月", "date"];
const NET_KEYWORDS = ["差引支給額", "手取り", "振込額", "差引", "net"];
const GROSS_KEYWORDS = ["総支給額", "支給合計", "総額", "gross"];
const DEDUCTION_KEYWORDS = ["保険", "年金", "税", "控除", "組合", "積立", "共済"];

/** Best-effort default column pick from header keywords — just seeds a
 * sensible starting Select value; the user can always override it. */
function guessColumn(header: string[] | null, keywords: string[], fallback: number): number {
  if (!header) return fallback;
  const idx = header.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k.toLowerCase())));
  return idx >= 0 ? idx : fallback;
}

function guessDeductionColumns(header: string[] | null): number[] {
  if (!header) return [];
  return header.reduce<number[]>((acc, h, i) => {
    if (DEDUCTION_KEYWORDS.some((k) => h.includes(k))) acc.push(i);
    return acc;
  }, []);
}

function columnLabel(i: number, header: string[] | null): string {
  const name = header?.[i]?.trim();
  return name ? `${name}(列${i + 1})` : `列${i + 1}`;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function SalaryCsvImport({ onClose }: Props) {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [rawRows, setRawRows] = useState<string[][]>([]);

  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [dateColumn, setDateColumn] = useState(0);
  const [fallbackPayday, setFallbackPayday] = useState("25");
  const [netAmountColumn, setNetAmountColumn] = useState(1);
  const [grossAmountColumn, setGrossAmountColumn] = useState<number | "">("");
  const [deductionColumns, setDeductionColumns] = useState<Set<number>>(new Set());

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    imported: number;
    duplicates: number;
    skippedUnparseable: number;
  } | null>(null);

  const preview = useMemo(() => buildPreview(rawRows, hasHeaderRow), [rawRows, hasHeaderRow]);
  const columnIndices = useMemo(
    () => Array.from({ length: preview.columnCount }, (_, i) => i),
    [preview.columnCount],
  );

  const mapping: SalaryColumnMapping = useMemo(
    () => ({
      hasHeaderRow,
      dateColumn,
      fallbackPayday: Math.min(31, Math.max(1, Number(fallbackPayday) || 25)),
      netAmountColumn,
      grossAmountColumn: grossAmountColumn === "" ? undefined : grossAmountColumn,
      deductionColumns: [...deductionColumns].sort((a, b) => a - b),
    }),
    [hasHeaderRow, dateColumn, fallbackPayday, netAmountColumn, grossAmountColumn, deductionColumns],
  );

  const liveResult = useMemo(
    () => mapCsvRowsToSalaries(rawRows, preview.header, mapping),
    [rawRows, preview.header, mapping],
  );

  async function handleFileSelected(f: File) {
    setError(null);
    setFile(f);
    try {
      const { text, encoding: detected } = await decodeCsvFileAuto(f);
      const rows = parseCsvRows(text);
      if (rows.length === 0) {
        setError("CSVを読み取れませんでした。ファイル形式を確認してください。");
        return;
      }
      setEncoding(detected);
      setRawRows(rows);

      const header = rows[0] ?? null;
      const lastCol = Math.max((header?.length ?? 1) - 1, 0);
      setDateColumn(guessColumn(header, DATE_KEYWORDS, 0));
      setNetAmountColumn(guessColumn(header, NET_KEYWORDS, lastCol));
      const guessedGross = guessColumn(header, GROSS_KEYWORDS, -1);
      setGrossAmountColumn(guessedGross >= 0 ? guessedGross : "");
      setDeductionColumns(new Set(guessDeductionColumns(header)));
      setResult(null);
      setStep("mapping");
    } catch {
      setError("CSVの読み込みに失敗しました。ファイル形式を確認してください。");
    }
  }

  async function handleEncodingChange(next: CsvEncoding) {
    if (!file) return;
    setEncoding(next);
    try {
      const text = await decodeCsvFileAs(file, next);
      setRawRows(parseCsvRows(text));
    } catch {
      setError("指定したエンコーディングでの読み込みに失敗しました。");
    }
  }

  function handlePickAnotherFile() {
    setStep("upload");
    setFile(null);
    setRawRows([]);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleDeductionColumn(i: number) {
    setDeductionColumns((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const existing = await db.salaries.toArray();
      const seenMonths = new Set(existing.map((s) => s.month));
      let imported = 0;
      let duplicates = 0;
      for (const row of liveResult.rows) {
        if (seenMonths.has(row.entry.month)) {
          duplicates++;
          continue;
        }
        seenMonths.add(row.entry.month);
        await db.salaries.add({ ...row.entry, createdAt: Date.now() });
        imported++;
      }
      setResult({
        total: liveResult.rows.length,
        imported,
        duplicates,
        skippedUnparseable: liveResult.skippedUnparseable,
      });
      setStep("result");
      showToast(`${imported}件を取り込みました`);
    } catch {
      setError("取込中にエラーが発生しました。");
    } finally {
      setImporting(false);
    }
  }

  if (step === "upload") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          給与明細のCSVを取り込めます。1行が1ヶ月分の給与に対応し、どの列が支給日・手取り額・控除項目かを次の画面で指定します(勤務先やソフトによって列構成は異なるため、取り込み前に内容を確認してください)。
        </p>
        <Button variant="secondary" className="w-full" onClick={() => fileInputRef.current?.click()}>
          CSVファイルを選択
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelected(f);
          }}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (step === "result" && result) {
    return (
      <div className="space-y-4">
        <Card className="space-y-1 text-sm text-slate-600">
          <p>取込対象: {result.total}件</p>
          <p>取り込み完了: {result.imported}件</p>
          <p>すでに登録済みの月のためスキップ: {result.duplicates}件</p>
          <p>解析できずスキップ: {result.skippedUnparseable}件</p>
        </Card>
        <Button className="w-full" onClick={onClose}>
          閉じる
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Select
        label="エンコーディング"
        value={encoding}
        onChange={(e) => handleEncodingChange(e.target.value as CsvEncoding)}
      >
        <option value="utf-8">{ENCODING_LABEL["utf-8"]}</option>
        <option value="shift_jis">{ENCODING_LABEL.shift_jis}</option>
      </Select>

      <Card className="space-y-2">
        <p className="text-xs font-medium text-slate-500">プレビュー(先頭{preview.sampleRows.length}行)</p>
        <div className="overflow-x-auto rounded-xl border border-white/40">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/40 text-slate-500">
              <tr>
                {columnIndices.map((i) => (
                  <th key={i} scope="col" className="whitespace-nowrap px-2.5 py-2 font-medium">
                    {columnLabel(i, preview.header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {preview.sampleRows.map((row, ri) => (
                <tr key={ri}>
                  {columnIndices.map((ci) => (
                    <td key={ci} className="whitespace-nowrap px-2.5 py-2 text-slate-700">
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={hasHeaderRow}
          onChange={(e) => setHasHeaderRow(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
        />
        1行目を見出しとして扱う(データとして取り込まない)
      </label>

      <Select label="支給日・対象月の列" value={dateColumn} onChange={(e) => setDateColumn(Number(e.target.value))}>
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <Input
        label="給料日(上の列が年月のみの場合に使用)"
        type="number"
        inputMode="numeric"
        value={fallbackPayday}
        onChange={(e) => setFallbackPayday(e.target.value)}
        min={1}
        max={31}
      />

      <Select
        label="手取り額(差引支給額)の列"
        value={netAmountColumn}
        onChange={(e) => setNetAmountColumn(Number(e.target.value))}
      >
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <Select
        label="総支給額の列(任意)"
        value={grossAmountColumn === "" ? "" : String(grossAmountColumn)}
        onChange={(e) => setGrossAmountColumn(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">なし</option>
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">
          控除項目として扱う列(「よく引かれてるもの」の集計対象)
        </span>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/40 bg-white/30 p-2">
          {columnIndices.map((i) => (
            <label key={i} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={deductionColumns.has(i)}
                  onChange={() => toggleDeductionColumn(i)}
                  className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                />
                {columnLabel(i, preview.header)}
              </span>
              <span className="text-xs text-slate-400">{preview.sampleRows[0]?.[i] ?? ""}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-white/40 p-3.5 text-sm text-slate-600">
        {liveResult.rows.length}件を取込予定(解析できない行{liveResult.skippedUnparseable}件)
        {liveResult.rows[0] && (
          <p className="mt-1 text-xs text-slate-500">
            例: {liveResult.rows[0].entry.month} 手取り{yen(liveResult.rows[0].entry.amount)}
            {liveResult.rows[0].entry.deductions ? `・控除${liveResult.rows[0].entry.deductions.length}項目` : ""}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-white/50 bg-white/80 px-5 py-3 backdrop-blur-md">
        <Button type="button" variant="secondary" className="flex-1" onClick={handlePickAnotherFile}>
          別のファイルを選ぶ
        </Button>
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          キャンセル
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={importing || liveResult.rows.length === 0}
          onClick={handleImport}
        >
          {importing ? "取込中..." : "取り込む"}
        </Button>
      </div>
    </div>
  );
}
