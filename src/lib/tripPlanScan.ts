import type { ExtractedTripItem } from "./mailPlanImport";
import type { ScannedImage } from "./imageDownscale";

/** 写真・文章から旅行の日程を読み取る(netlify/functions/extractTripPlan.ts,
 * api/extractTripPlan.ts)。読み取りはGmailの取り込みと同じ関数を呼ぶ — 同じ
 * 「日程を取り出す」判断を2か所に分けて持つと、片方だけ良くなってしまうため。
 *
 * Anthropicの鍵をブラウザに出さないためサーバー経由にする点は、レシートの
 * 読み取り(src/lib/receiptScan.ts)やAI下書き(src/lib/gmail.ts)と同じ。 */

/** サーバーが受け取れる画像形式(netlify/functions/extractTripPlan.ts の ALLOWED_MEDIA_TYPES)。 */
export const SUPPORTED_SCAN_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** 一度に渡せる写真の枚数(サーバー側の MAX_IMAGES と揃える)。 */
export const MAX_SCAN_IMAGES = 4;

export interface TripPlanScanInput {
  /** 貼り付けられた文章。写真だけのときは空でよい。 */
  text?: string;
  images?: ScannedImage[];
  /** 「来月12日」のような書き方を直すための基準日(YYYY-MM-DD)。 */
  today: string;
  /** 入れ先の旅行の期間。「2日目」を実際の日付に直すのに使う。 */
  tripStart?: string;
  tripEnd?: string;
}

/** サーバーの `{ error: "..." }` と HTTPステータスを、そのまま持ったエラー。
 * ステータスは describePlanImportError(src/lib/mailPlanImport.ts)が
 * 「アプリの更新がまだ届いていません」などの案内に読み替えるのに使う。 */
export class TripPlanScanError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TripPlanScanError";
    this.status = status;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `extractTripPlan failed (${res.status})`;
  } catch {
    return `extractTripPlan failed (${res.status})`;
  }
}

export async function extractTripPlanFromSources(input: TripPlanScanInput): Promise<ExtractedTripItem[]> {
  const res = await fetch("/api/extractTripPlan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: input.text?.trim() || undefined,
      images: input.images?.length ? input.images : undefined,
      today: input.today,
      tripStart: input.tripStart,
      tripEnd: input.tripEnd,
    }),
  });
  if (!res.ok) {
    throw new TripPlanScanError(await readErrorMessage(res), res.status);
  }
  const data = (await res.json()) as { items?: ExtractedTripItem[] };
  return data.items ?? [];
}
