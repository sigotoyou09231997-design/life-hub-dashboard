import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, ensureDefaultSettings } from "../../db/schema";
import { decodePayPayCsvFile, parsePayPayCsv, classifyForHousehold } from "../../lib/paypayCsv";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useToast } from "../ui/ToastProvider";

interface ImportResult {
  total: number;
  householdImported: number;
  skippedInternal: number;
  duplicates: number;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

export function PayPayImport() {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = useLiveQuery(() => db.settings.toCollection().first(), []);
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
    setResult(null);
    try {
      const text = await decodePayPayCsvFile(file);
      const rows = parsePayPayCsv(text);
      if (rows.length === 0) {
        setError("取引データを読み取れませんでした。PayPayの取引履歴CSVか確認してください。");
        setImporting(false);
        return;
      }

      const [existingLedger, existingTx] = await Promise.all([
        db.paypayTransactions.toArray(),
        db.transactions.toArray(),
      ]);
      const seenLedgerKeys = new Set(existingLedger.map((r) => r.externalId));
      const seenTxKeys = new Set(existingTx.filter((t) => t.externalId).map((t) => t.externalId!));

      const now = Date.now();
      let householdImported = 0;
      let skippedInternal = 0;
      let duplicates = 0;

      for (const row of rows) {
        if (seenLedgerKeys.has(row.externalId)) {
          duplicates++;
          continue;
        }
        seenLedgerKeys.add(row.externalId);
        await db.paypayTransactions.add({
          externalId: row.externalId,
          date: row.date,
          amount: row.amount,
          content: row.content,
          counterparty: row.counterparty,
          importedAt: now,
        });

        const classified = classifyForHousehold(row);
        if (!classified) {
          skippedInternal++;
          continue;
        }
        if (seenTxKeys.has(row.externalId)) continue;
        seenTxKeys.add(row.externalId);
        await db.transactions.add({
          type: classified.type,
          amount: classified.amount,
          category: classified.category,
          store: classified.store,
          memo: classified.memo,
          method: "電子マネー",
          date: row.date,
          isFixed: false,
          externalId: row.externalId,
          createdAt: now,
        });
        householdImported++;
      }

      setResult({ total: rows.length, householdImported, skippedInternal, duplicates });
      showToast(`${householdImported}件を取り込みました`);
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

  return (
    <div className="space-y-4">
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
          PayPayアプリの「取引履歴」からCSVをエクスポートして読み込むと、支払い・送金・受け取りが支出/収入として自動登録されます(チャージや口座出金などウォレット内の移動は残高計算にのみ反映し、お金管理には登録しません)。
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

        {result && (
          <div className="mt-4 space-y-1 rounded-xl bg-white/40 p-3.5 text-sm text-slate-600">
            <p>取込対象: {result.total}件</p>
            <p>お金管理に登録: {result.householdImported}件(支払い・送金・受取)</p>
            <p>ウォレット内移動としてスキップ: {result.skippedInternal}件(チャージ・口座出金など)</p>
            <p>重複のためスキップ: {result.duplicates}件</p>
          </div>
        )}
      </Card>
    </div>
  );
}
