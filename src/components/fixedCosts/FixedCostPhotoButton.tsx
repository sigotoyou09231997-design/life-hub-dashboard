import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { extractFixedCostFromImage, SUPPORTED_RECEIPT_MEDIA_TYPES } from "../../lib/receiptScan";
import { prepareImageForScan } from "../../lib/imageDownscale";
import { todayStr } from "../../lib/date";
import type { FixedCostDraft } from "../../lib/fixedCosts";

interface Props {
  onRead: (draft: FixedCostDraft) => void;
}

/**
 * 請求書・料金のお知らせ・契約書の写真から、固定費のフォームを埋める(2026-10-20)。
 * 読み取りは AI(レシートの読み取りと同じ /api/extractReceipt)。読み取った値はフォームに入れるだけで、保存は本人が確かめてから。
 */
export function FixedCostPhotoButton({ onRead }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function handleFile(file: File) {
    setMessage(null);
    if (!SUPPORTED_RECEIPT_MEDIA_TYPES.includes(file.type) && !/^image\//.test(file.type)) {
      setMessage({ tone: "error", text: "写真(jpeg・png・webp)を選んでください。" });
      return;
    }
    setReading(true);
    try {
      const image = await prepareImageForScan(file);
      const read = await extractFixedCostFromImage(image.base64, image.mediaType, todayStr());
      if (!read) {
        setMessage({ tone: "error", text: "この写真からは固定費を読み取れませんでした。金額や支払日が写るように撮り直すか、手で入れてください。" });
        return;
      }
      onRead({
        title: read.title,
        category: read.category,
        amount: read.amount,
        cycle: read.cycle,
        dueDay: read.dueDay,
        billingMonth: read.billingMonth,
      });
      setMessage({ tone: "ok", text: "写真から読み取って入れました。違う所は直してから追加してください。" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setMessage({
        tone: "error",
        text: /credit|balance|残高|billing/i.test(detail)
          ? "AIの利用残高が足りず、読み取れませんでした。手で入れてください。"
          : "写真を読み取れませんでした。通信を確かめるか、手で入れてください。",
      });
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="fx-photo">
      <button type="button" className="fx-photo__btn" disabled={reading} onClick={() => inputRef.current?.click()}>
        <Camera size={16} aria-hidden="true" /> {reading ? "読み取っています…" : "請求書・明細の写真から入れる"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {message && (
        <p className={`fx-photo__note${message.tone === "error" ? " is-error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
