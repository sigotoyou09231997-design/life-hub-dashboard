import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureDefaultSettings } from "../../db/schema";
import { decodePayPayCsvFile } from "../../lib/paypayCsv";
import { importPayPayCsvText, type PayPayImportOutcome } from "../../lib/paypayImport";
import { PayPayImportResult } from "./PayPayImportResult";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function PayPayImport() {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<PayPayImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
  const importedCount = useLiveQuery(() => db.paypayTransactions.count(), []);
  const balanceInfo = useLiveQuery(async () => {
    const s = await db.settings.toCollection().first();
    const baseline = s?.paypayBalance ?? 0;
    const anchor = s?.paypayBalanceUpdatedAt ?? 0;
    const newerEntries = await db.paypayTransactions.where("importedAt").above(anchor).toArray();
    const delta = newerEntries.reduce((sum, e) => sum + e.amount, 0);
    return { estimated: baseline + delta, anchor };
  }, []);

  async function handleFile(file: File) {
    setImporting(true);
    setError(null);
    setOutcome(null);
    try {
      const text = await decodePayPayCsvFile(file);
      const result = await importPayPayCsvText(text);
      if (!result) {
        setError("取引データを読み取れませんでした。PayPayの取引履歴CSVか確認してください。");
        return;
      }
      setOutcome(result);
      showToast(result.added.length > 0 ? `${result.added.length}件を取り込みました` : "新しく入れる取引はありませんでした");
    } catch {
      setError("CSVの読み込みに失敗しました。ファイル形式を確認してください。");
      showToast("CSVの読み込みに失敗しました", "error");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUpdateBalance() {
    const current = settings ?? (await ensureDefaultSettings());
    if (!current.id) return;
    await db.settings.update(current.id, {
      paypayBalance: Number(balanceInput) || 0,
      paypayBalanceUpdatedAt: Date.now(),
    });
    setBalanceInput("");
    showToast("残高を更新しました");
  }

  // 残高もまだ入れておらず、取り込みも1件も無いときは、カード2枚で画面の半分ほどしか
  // 埋まらず、下に背景写真だけの帯が残る。読み込みカードを画面の下まで伸ばして、
  // 空くぶんを取込結果が出る場所に渡す(.is-empty-fill、index.css)。
  const nothingYet = importedCount === 0 && !balanceInfo?.anchor;

  return (
    <div className={`space-y-4 ${nothingYet ? "is-empty-fill" : ""}`}>
      <Card>
        <p className="text-sm text-slate-400">PayPay残高(推定)</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">
          {yen(balanceInfo?.estimated ?? 0)}
        </p>
        <p className="mt-1.5 text-xs text-slate-400">
          {balanceInfo?.anchor ? "手入力した残高に、それ以降取り込んだ入出金を足し引きした推定値です。" : "残高が未設定です。下から現在の残高を入力してください。"}
        </p>
        <div className="mt-4 flex gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="現在のPayPay残高"
            value={balanceInput}
            onChange={(e) => setBalanceInput(e.target.value)}
          />
          <Button onClick={handleUpdateBalance} className="shrink-0">
            更新
          </Button>
        </div>
      </Card>

      <Card>
        <p className="mb-1 text-sm font-medium text-slate-600">PayPay CSV読み込み</p>
        <p className="mb-3 text-xs text-slate-400">
          PayPayアプリの「取引履歴」からCSVをエクスポートして読み込むと、支払い・送金・受け取りが支出/収入として自動登録されます(チャージや口座への送金などウォレット内の移動は残高計算にのみ反映し、お金管理には登録しません)。同じファイルや期間の重なるファイルを入れ直しても、入っている取引は二重になりません。
        </p>
        <Button
          variant="secondary"
          className="w-full"
          disabled={importing}
          onClick={() => fileInputRef.current?.click()}
        >
          {importing ? "読み込み中..." : "CSVファイルを選択"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {outcome && <PayPayImportResult outcome={outcome} />}
      </Card>
    </div>
  );
}
