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

/** サーバーが1回で返す形。truncated は、サーバーの件数の上限で後ろを切った時だけ立つ。 */
interface ScanPiece {
  items: ExtractedTripItem[];
  truncated: boolean;
}

async function requestTripPlan(input: TripPlanScanInput): Promise<ScanPiece> {
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
  const data = (await res.json()) as { items?: ExtractedTripItem[]; truncated?: boolean };
  return { items: data.items ?? [], truncated: data.truncated === true };
}

/** 1回だけ読み取って、日程の一覧を返す(長い文章を分けない版)。 */
export async function extractTripPlanFromSources(input: TripPlanScanInput): Promise<ExtractedTripItem[]> {
  return (await requestTripPlan(input)).items;
}

// ── 長い文章を日ごとに分けて読み取る ──────────────────────────────────────
//
// 7日ぶんの旅程表のように長い文章を1回で読ませると、
//  - 応答が長くなって Vercel の maxDuration(60秒)に当たり、504で失敗する
//  - サーバーの件数の上限で、日付順の後ろの日が黙って消える(2026-10-04に実際に起きた)
// ので、日の見出しで区切って別々に読み取り、あとで合わせる。

/** 1回で読ませる文章の目安(文字数)。字数より「何件になるか」が効く — 時刻を1行ずつ書いた
 * 旅程表は30〜40字で1件になるので、2,500字では1回で50件を超え、サーバーの上限(40件)に
 * 当たった(実物の7日ぶんで確認)。1,200字なら、おおむね1日ぶんが1回になる。
 * 1日ぶんがこれより長くても途中では切らない。見出しの無い短いメモは分けずに1回で読む。 */
export const SCAN_CHUNK_CHARS = 1200;

/** 分けて読む回数の上限。これを超える文章は、費用と待ち時間が読めなくなるので受け付けない。 */
export const MAX_SCAN_CHUNKS = 12;

/** 同時に走らせる読み取りの数。全部を一度に投げると、AIの利用制限(429)に当たりやすい。 */
const SCAN_PARALLEL = 4;

const HEADING_MARKERS = "■□●○◆◇▼▽▲△▶◎★☆【［[";
const WEEKDAY = /^(?:\(\s*[月火水木金土日祝]\s*曜?日?\s*\)|[月火水木金土日]曜日?)/;
const NTH_DAY = /^(?:第?\d{1,2}日目|Day\s*\d{1,2}|初日|最終日)/i;
const DATE_AT_START = /^(?:\d{4}\s*[/.年-]\s*)?\d{1,2}\s*[/月.]\s*\d{1,2}\s*日?/;

/** その1行が「1日ぶんの欄の始まり」を示す見出しか。
 *
 * 「■12/27(日)」「【12/28】」「12/29(火)」「2026年12月30日(水)」「3日目」を見出しとみなす。
 * 次のものは見出しにしない(欄の途中で切ると、後ろ半分から日付が消えるため):
 * 時刻の付いた行(「9/12 10:00 羽田発」は予定そのもの)、「12/27〜12/30」のような期間、
 * 印も曜日も無い「12/31」だけの行(基本情報の中に出てくる)。
 *
 * ChatGPT の返事は見出しを Markdown で飾りがちなので(「### 12/27(日)」「**12/27(日)**」)、
 * その飾りは外して見る。外さないと見出しと見なされず、複数日が1回に詰まって後ろの日が切れる。
 * 「#」は見出しの印そのものなので、「■」と同じく印として扱う。 */
function isDayHeading(rawLine: string): boolean {
  const normalized = rawLine.normalize("NFKC").trim();
  const hashed = /^#{1,6}\s/.test(normalized);
  const line = normalized
    .replace(/^(?:#{1,6}\s+|>\s*)/, "")
    .replace(/^[*_]{1,3}/, "")
    .replace(/[*_]{1,3}$/, "")
    .trim();
  if (!line || line.length > 40) return false;
  if (/\d{1,2}:\d{2}/.test(line) || /[〜~～]/.test(line)) return false;

  let rest = line;
  const marked = hashed || HEADING_MARKERS.includes(rest[0]);
  if (marked && HEADING_MARKERS.includes(rest[0])) rest = rest.slice(1).trimStart();

  const nth = rest.match(NTH_DAY);
  const date = nth ? null : rest.match(DATE_AT_START);
  if (!nth && !date) return false;

  let after = rest.slice((nth ?? date)![0].length).trim();
  const weekday = after.match(WEEKDAY);
  if (!marked && !weekday && !nth) return false;
  if (weekday) after = after.slice(weekday[0].length);
  // 閉じ括弧や区切りのあとに、見出しとして短い題(「小金井→高松」程度)だけが続く行まで。
  return after.replace(/^[】\])\s]+/, "").length <= 25;
}

function splitIntoSections(text: string): string[] {
  const sections: string[][] = [[]];
  for (const line of text.split(/\r?\n/)) {
    const current = sections[sections.length - 1];
    if (isDayHeading(line) && current.some((existing) => existing.trim())) sections.push([]);
    sections[sections.length - 1].push(line);
  }
  return sections.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

/** 貼り付けられた文章を、1回ぶんずつに分ける。
 *
 * 短い文章と、日の見出しが見つからない文章は分けない(1つだけ返す)。分けるのは日の見出しの
 * ところだけで、1日ぶんの欄は途中で切らない — 切ると後ろ半分は日付を失い、読み取れない。
 * 見出しより前の「基本情報」は、最初の日と同じ1回に入る(入りきらなければ単独)。 */
export function splitScanText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= SCAN_CHUNK_CHARS) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  let currentTimed = 0;
  for (const section of splitIntoSections(trimmed)) {
    const timed = countTimedLines(section);
    const tooLong = current.length + section.length + 2 > SCAN_CHUNK_CHARS;
    const tooMany = currentTimed + timed > SCAN_TIMED_LINES_PER_CHUNK;
    if (current && (tooLong || tooMany)) {
      chunks.push(current);
      current = section;
      currentTimed = timed;
    } else {
      current = current ? `${current}\n\n${section}` : section;
      currentTimed += timed;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 1回に入れる、時刻の付いた行の数の目安。1行がほぼ1件になるので、サーバーの件数の上限
 * (40件)に余裕を残す。字数だけで詰めると、短い行が並ぶ日が2日重なって上限に当たる。 */
const SCAN_TIMED_LINES_PER_CHUNK = 30;

function countTimedLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => /\d{1,2}:\d{2}/.test(line.normalize("NFKC"))).length;
}

export interface TripPlanScanResult {
  items: ExtractedTripItem[];
  /** 全部は読み取れていない時の断り。空なら、渡したものは全部読めている。 */
  notices: string[];
}

/** 一時的な失敗(通信の途切れ・タイムアウト・AI側の混雑)だけ、もう一度試す。
 * 「内容が多すぎる」(502)のように、やり直しても同じになるものは試さない。 */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 503 || status === 504 || status === 529 || (status === undefined && err instanceof TypeError);
}

async function requestWithRetry(input: TripPlanScanInput): Promise<ScanPiece> {
  try {
    return await requestTripPlan(input);
  } catch (err) {
    if (!isTransient(err)) throw err;
    return await requestTripPlan(input);
  }
}

/** 断りの文に添える、その部分の頭の一行。 */
function labelOf(text: string | undefined): string {
  if (text === undefined) return "写真";
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^[=＝\-－ー─━_＿\s]+$/.test(line));
  const label = first ?? "";
  return label.length > 14 ? `${label.slice(0, 14)}…` : label;
}

/** 写真・文章から日程を読み取る。長い文章は日ごとに分けて読み、1つの一覧にまとめる。
 *
 * 一部だけ失敗しても、読めたぶんは捨てない。ただし黙りもしない — どこが読めていないかを
 * notices で返し、画面が日程の上に出す(読めていない日があることに気付けないまま
 * 旅に出ると困るため)。全部失敗した時だけエラーにする。
 *
 * onProgress は、分けて読む時だけ呼ばれる(読み終えた数, 全体の数)。 */
export async function scanTripPlan(
  input: TripPlanScanInput,
  onProgress?: (done: number, total: number) => void,
): Promise<TripPlanScanResult> {
  const pieces = splitScanText(input.text ?? "");

  if (pieces.length <= 1) {
    const piece = await requestTripPlan(input);
    return {
      items: piece.items,
      notices: piece.truncated ? ["予定が多く、一部が読み取りきれていません。分けて貼り直して、もう一度お試しください"] : [],
    };
  }
  if (pieces.length > MAX_SCAN_CHUNKS) {
    throw new TripPlanScanError("文章が長すぎます。何日かずつに分けて、数回に分けてお試しください", 400);
  }

  // 写真は文章とは別の1回にする(写真を全部の回に付けて送ると、重いうえに同じ予定が何度も返る)。
  const jobs: { text: string | undefined; input: TripPlanScanInput }[] = pieces.map((text) => ({
    text,
    input: { ...input, text, images: undefined },
  }));
  if (input.images?.length) jobs.push({ text: undefined, input: { ...input, text: undefined } });

  const results: (ScanPiece | Error)[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  onProgress?.(0, jobs.length);
  async function worker() {
    while (next < jobs.length) {
      const index = next++;
      try {
        results[index] = await requestWithRetry(jobs[index].input);
      } catch (err) {
        console.error("[tripPlanScan] a part failed to read:", err);
        results[index] = err instanceof Error ? err : new Error(String(err));
      }
      onProgress?.(++done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_PARALLEL, jobs.length) }, worker));

  if (results.every((result) => result instanceof Error)) throw results[0];

  const items: ExtractedTripItem[] = [];
  const notices: string[] = [];
  results.forEach((result, index) => {
    const label = labelOf(jobs[index].text);
    if (result instanceof Error) {
      notices.push(`「${label}」から始まる部分が読み取れませんでした。その部分だけ貼り直して、もう一度お試しください`);
      return;
    }
    items.push(...result.items);
    if (result.truncated) {
      notices.push(`「${label}」から始まる部分は予定が多く、一部が読み取りきれていません。その部分だけ貼り直して、もう一度お試しください`);
    }
  });
  // 日程表と同じ並び(日付→時刻)。分けて読んだ結果を、日付順に戻す。
  items.sort((a, b) => (a.date === b.date ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.date.localeCompare(b.date)));
  return { items, notices };
}
