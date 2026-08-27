import { useRef, useState } from "react";
import { Camera, Loader2, Receipt } from "lucide-react";
import { extractReceiptFromImage, fileToBase64, SUPPORTED_RECEIPT_MEDIA_TYPES, type ExtractedReceipt } from "../../lib/receiptScan";
import { todayStr } from "../../lib/date";
import { EmptyState } from "../ui/EmptyState";
import { Button } from "../ui/Button";

/** サーバー側のMAX_BASE64_CHARSに引っかかる前に、明らかに大きすぎる画像をここで
 * 弾く(base64化・アップロードの手間そのものを省く)。 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface Props {
  /** 読み取れた分(空でもよい)を渡す — 確認・修正は呼び出し側が開くExpenseFormで行う。 */
  onExtracted: (receipt: ExtractedReceipt) => void;
  onCancel: () => void;
}

type Status = "idle" | "reading" | "unreadable" | "error";

/**
 * レシート・領収書の画像をAIに読み取らせ、店名・日付・金額などを支出フォームへ
 * 引き継ぐ。読み取り結果はここでは保存せず、必ずExpenseForm側の確認・修正・
 * 「記録する」を経由させる(LIFE_HUB_CLAUDE_CODE.md §4.7)。
 */
export function ReceiptScanForm({ onExtracted, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function reset() {
    setStatus("idle");
    setErrorMessage(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  async function handleFileSelected(file: File | undefined) {
    if (!file) return;
    if (!SUPPORTED_RECEIPT_MEDIA_TYPES.includes(file.type)) {
      setStatus("error");
      setErrorMessage("対応していない画像形式です。写真(jpeg/png/webp)を選んでください。");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("error");
      setErrorMessage("画像が大きすぎます。もう少し小さい画像でお試しください。");
      return;
    }

    setStatus("reading");
    setErrorMessage(null);
    setPreviewUrl(URL.createObjectURL(file));
    try {
      const base64 = await fileToBase64(file);
      const receipt = await extractReceiptFromImage(base64, file.type, todayStr());
      if (!receipt) {
        setStatus("unreadable");
        return;
      }
      onExtracted(receipt);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "レシートの読み取りに失敗しました");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_RECEIPT_MEDIA_TYPES.join(",")}
        capture="environment"
        hidden
        onChange={(e) => {
          void handleFileSelected(e.target.files?.[0]);
          e.target.value = ""; // 同じ写真を選び直せるようにリセット
        }}
      />

      {status === "idle" && (
        <EmptyState
          icon={Receipt}
          title="レシートを撮影・選択"
          description="店名・日付・金額をAIが読み取ります。読み取り結果は次の画面で確認・修正できます。"
        />
      )}

      {previewUrl && (
        <div className="overflow-hidden rounded-xl border border-white/50">
          <img src={previewUrl} alt="選んだレシート" className="max-h-64 w-full object-contain" />
        </div>
      )}

      {status === "reading" && (
        <p className="flex items-center justify-center gap-2 py-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          読み取っています…
        </p>
      )}

      {status === "unreadable" && (
        <p className="text-center text-sm text-slate-500">
          レシートの内容を読み取れませんでした。手入力で追加するか、別の写真でもう一度お試しください。
        </p>
      )}

      {status === "error" && errorMessage && <p className="text-center text-sm text-danger">{errorMessage}</p>}

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          キャンセル
        </Button>
        {status === "unreadable" && (
          <Button type="button" variant="secondary" className="flex-1" onClick={() => onExtracted({})}>
            手入力で追加
          </Button>
        )}
        {status !== "reading" && (
          <Button
            type="button"
            className="flex-1"
            onClick={() => {
              reset();
              inputRef.current?.click();
            }}
          >
            <Camera size={17} />
            {status === "idle" ? "写真を選ぶ" : "撮り直す"}
          </Button>
        )}
      </div>
    </div>
  );
}
