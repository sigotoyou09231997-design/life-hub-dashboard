/** レシート画像から支出を読み取る(netlify/functions/extractReceipt.ts, api/extractReceipt.ts)。
 * Anthropic APIキーをブラウザに出さないためサーバー経由にする点はGmailのAI下書き生成
 * (src/lib/gmail.tsのgenerateDraft)と同じ。 */
export interface ExtractedReceipt {
  storeName?: string;
  date?: string;
  amount?: number;
  category?: string;
  paymentMethod?: string;
  memo?: string;
}

/** サーバーが対応する画像形式。src/components/expense/ReceiptScanForm.tsxの
 * ファイル選択でこれ以外のtypeが来た場合は弾く。 */
export const SUPPORTED_RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** サーバーの{ error: "..." }をそのままエラーメッセージにする(callFunction/gmail.tsの
 * ApiFunctionErrorと同じ考え方。用途が違うのでこのファイル専用に持つ)。 */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

/** 画像をAnthropicへ渡せる生base64(データURLの接頭辞なし)にする。
 * 縮めた後のBlobも渡せるよう Blob で受ける(src/lib/imageDownscale.ts)。 */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

export async function extractReceiptFromImage(imageBase64: string, mediaType: string, today: string): Promise<ExtractedReceipt | null> {
  const res = await fetch("/api/extractReceipt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType, today }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "レシートの読み取りに失敗しました"));
  }
  const data = (await res.json()) as { receipt: ExtractedReceipt | null };
  return data.receipt;
}

/** 固定費の写真(請求書・料金のお知らせ・契約書)から読み取った下書き。サーバー側の ExtractedFixedCost と同じ形。 */
export interface ExtractedFixedCost {
  title?: string;
  category?: string;
  amount?: number;
  cycle?: "monthly" | "yearly";
  dueDay?: number;
  billingMonth?: number;
  memo?: string;
}

/** 固定費の写真を読む(同じ /api/extractReceipt に kind: "fixedCost" を付けて送る)。読み取れなければ null。 */
export async function extractFixedCostFromImage(imageBase64: string, mediaType: string, today: string): Promise<ExtractedFixedCost | null> {
  const res = await fetch("/api/extractReceipt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType, today, kind: "fixedCost" }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "写真の読み取りに失敗しました"));
  }
  const data = (await res.json()) as { fixedCost: ExtractedFixedCost | null };
  return data.fixedCost;
}
