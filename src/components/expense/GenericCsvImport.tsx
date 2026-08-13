import { useMemo, useRef, useState } from "react";
import { db } from "../../db/schema";
import type { TransactionType } from "../../types";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS } from "../../lib/categories";
import { parseCsvRows, decodeCsvFileAuto, decodeCsvFileAs, type CsvEncoding } from "../../lib/csv";
import { buildPreview, mapCsvRowsToTransactions, type ColumnMapping } from "../../lib/genericCsvImport";
import { Card } from "../ui/Card";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/ToastProvider";

interface Props {
  onClose: () => void;
}

type Step = "upload" | "mapping" | "result";
type AmountKind = "signed" | "split";

const ENCODING_LABEL: Record<CsvEncoding, string> = { "utf-8": "UTF-8", shift_jis: "Shift-JIS" };

/** Best-effort default column pick from header keywords — just seeds a
 * sensible starting Select value; the user can always override it. */
function guessColumn(header: string[] | null, keywords: string[], fallback: number): number {
  if (!header) return fallback;
  const idx = header.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
  return idx >= 0 ? idx : fallback;
}

function columnLabel(i: number, header: string[] | null): string {
  const name = header?.[i]?.trim();
  return name ? `${name}(列${i + 1})` : `列${i + 1}`;
}

export function GenericCsvImport({ onClose }: Props) {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [rawRows, setRawRows] = useState<string[][]>([]);

  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [dateColumn, setDateColumn] = useState(0);
  const [amountKind, setAmountKind] = useState<AmountKind>("signed");
  const [signedColumn, setSignedColumn] = useState(1);
  const [positiveType, setPositiveType] = useState<TransactionType>("expense");
  const [outflowColumn, setOutflowColumn] = useState(1);
  const [inflowColumn, setInflowColumn] = useState(2);
  const [descriptionColumn, setDescriptionColumn] = useState<number | "">("");
  const [storeColumn, setStoreColumn] = useState<number | "">("");
  const [defaultExpenseCategory, setDefaultExpenseCategory] = useState(
    EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1],
  );
  const [defaultIncomeCategory, setDefaultIncomeCategory] = useState(
    INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1],
  );
  const [defaultMethod, setDefaultMethod] = useState("");

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

  const mapping: ColumnMapping = useMemo(
    () => ({
      hasHeaderRow,
      dateColumn,
      amount:
        amountKind === "signed"
          ? { kind: "signed", column: signedColumn, positiveType }
          : { kind: "split", outflowColumn, inflowColumn },
      descriptionColumn: descriptionColumn === "" ? undefined : descriptionColumn,
      storeColumn: storeColumn === "" ? undefined : storeColumn,
      defaultExpenseCategory,
      defaultIncomeCategory,
      defaultMethod: defaultMethod === "" ? undefined : defaultMethod,
    }),
    [
      hasHeaderRow,
      dateColumn,
      amountKind,
      signedColumn,
      positiveType,
      outflowColumn,
      inflowColumn,
      descriptionColumn,
      storeColumn,
      defaultExpenseCategory,
      defaultIncomeCategory,
      defaultMethod,
    ],
  );

  const liveResult = useMemo(() => mapCsvRowsToTransactions(rawRows, mapping), [rawRows, mapping]);
  const expenseCount = liveResult.rows.filter((r) => r.transaction.type === "expense").length;
  const incomeCount = liveResult.rows.filter((r) => r.transaction.type === "income").length;

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

      // hasHeaderRow starts true (its own default), so rows[0] is the header
      // to key guesses off of; falls back to plain positional defaults when
      // a keyword isn't found (or there's effectively no header to read).
      const header = rows[0] ?? null;
      const lastCol = Math.max((header?.length ?? 1) - 1, 0);
      setDateColumn(guessColumn(header, ["日付", "取引日", "date"], 0));
      setSignedColumn(guessColumn(header, ["金額", "amount"], lastCol));
      setOutflowColumn(guessColumn(header, ["出金", "支出", "withdrawal", "debit"], lastCol > 0 ? lastCol - 1 : lastCol));
      setInflowColumn(guessColumn(header, ["入金", "収入", "deposit", "credit"], lastCol));
      setDescriptionColumn("");
      setStoreColumn("");
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

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const existing = await db.transactions.toArray();
      const seen = new Set(existing.filter((t) => t.externalId).map((t) => t.externalId!));
      let imported = 0;
      let duplicates = 0;
      for (const row of liveResult.rows) {
        if (seen.has(row.externalId)) {
          duplicates++;
          continue;
        }
        seen.add(row.externalId);
        await db.transactions.add({ ...row.transaction, createdAt: Date.now() });
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
          銀行明細・クレジットカード明細など、任意のCSVファイルを取り込めます。取り込む前に、どの列が日付・金額かを次の画面で指定します。
        </p>
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
        >
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
          <p>重複のためスキップ: {result.duplicates}件</p>
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

      <Select label="日付列" value={dateColumn} onChange={(e) => setDateColumn(Number(e.target.value))}>
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-slate-600">金額の形式</span>
        <Tabs
          options={[
            { value: "signed", label: "1列(符号で判定)" },
            { value: "split", label: "2列(出金/入金)" },
          ]}
          value={amountKind}
          onChange={(v) => setAmountKind(v)}
          dense
        />
      </div>

      {amountKind === "signed" ? (
        <>
          <Select label="金額列" value={signedColumn} onChange={(e) => setSignedColumn(Number(e.target.value))}>
            {columnIndices.map((i) => (
              <option key={i} value={i}>
                {columnLabel(i, preview.header)}
              </option>
            ))}
          </Select>
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-600">符号の意味</span>
            <Tabs
              options={[
                { value: "expense", label: "プラス=支出" },
                { value: "income", label: "プラス=収入" },
              ]}
              value={positiveType}
              onChange={(v) => setPositiveType(v)}
              dense
            />
          </div>
        </>
      ) : (
        <>
          <Select label="出金列" value={outflowColumn} onChange={(e) => setOutflowColumn(Number(e.target.value))}>
            {columnIndices.map((i) => (
              <option key={i} value={i}>
                {columnLabel(i, preview.header)}
              </option>
            ))}
          </Select>
          <Select label="入金列" value={inflowColumn} onChange={(e) => setInflowColumn(Number(e.target.value))}>
            {columnIndices.map((i) => (
              <option key={i} value={i}>
                {columnLabel(i, preview.header)}
              </option>
            ))}
          </Select>
        </>
      )}

      <Select
        label="内容・摘要列(任意・重複判定の精度が上がります)"
        value={descriptionColumn === "" ? "" : String(descriptionColumn)}
        onChange={(e) => setDescriptionColumn(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">なし</option>
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <Select
        label="店舗・取引先列(任意)"
        value={storeColumn === "" ? "" : String(storeColumn)}
        onChange={(e) => setStoreColumn(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">なし</option>
        {columnIndices.map((i) => (
          <option key={i} value={i}>
            {columnLabel(i, preview.header)}
          </option>
        ))}
      </Select>

      <Select
        label="支出のデフォルトカテゴリ"
        value={defaultExpenseCategory}
        onChange={(e) => setDefaultExpenseCategory(e.target.value)}
      >
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        label="収入のデフォルトカテゴリ"
        value={defaultIncomeCategory}
        onChange={(e) => setDefaultIncomeCategory(e.target.value)}
      >
        {INCOME_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        label="支払い方法(任意・支出のみに適用)"
        value={defaultMethod}
        onChange={(e) => setDefaultMethod(e.target.value)}
      >
        <option value="">未設定</option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Select>

      <div className="rounded-xl bg-white/40 p-3.5 text-sm text-slate-600">
        {liveResult.rows.length}件を取込予定(支出{expenseCount}件・収入{incomeCount}件、解析できない行
        {liveResult.skippedUnparseable}件)
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
