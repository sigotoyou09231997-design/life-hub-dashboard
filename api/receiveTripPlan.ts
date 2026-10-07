import { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * ChatGPT(専用GPT)が作った旅程を、LIFE HUB の受信箱へ置く受け口。
 * GPT の「アクション」から呼ばれる(public/chatgpt/openapi.json が接続の定義)。
 *
 * ここは**入れ物に置くだけ**で、日程には入れない。受信箱の旅程は、アプリの確認画面を通して
 * 本人が入れる。コードの照合と受信箱への書き込みは、Supabase の関数 receive_chatgpt_trip
 * (supabase/sql/027_chatgpt_trip_inbox.sql)が行う — 公開鍵(anon key)だけで呼べるので、
 * この関数に強い鍵(service role)を持たせずに済む。
 *
 * 中身の検証をここでするのは、GPT が返してくる値の形が揺れるため(「2026-9-3」「9:00」)。
 * 金額は受け付けない: 読み取りは金額を旅行の費用に積むので、GPT の見積もりが費用に入ってしまう。
 *
 * 反対側のフォルダ(api/ ↔ netlify/functions/)の同名ファイルと、中核の部分は完全に同一
 * (scripts/gen-netlify-functions.mjs が api/ から netlify/functions/ を作り直す)。
 * api/ から netlify/functions/ を import すると Vercel で落ちるので、二重に書いている
 * (netlify/__tests__/receiveTripPlan.test.ts が、同じ入力で同じ結果になることを確かめる)。
 */

/** 1回に受け取る件数の上限。Supabase の関数側(200)と揃える。 */
export const MAX_ITEMS = 200;

const TYPES = ["transport", "lodging", "meal", "sightseeing", "other"] as const;
type ItemType = (typeof TYPES)[number];

export interface ReceivedItem {
  date: string;
  startTime?: string;
  endTime?: string;
  title: string;
  location?: string;
  endLocation?: string;
  memo?: string;
  type: ItemType;
}

export interface ReceivedPlan {
  /** 正規化したコード(大文字の英数字だけ)。 */
  code: string;
  tripName?: string;
  startDate?: string;
  endDate?: string;
  items: ReceivedItem[];
  /** 日付か題名が読めずに捨てた件数。 */
  skipped: number;
}

export type ParseResult = { ok: true; plan: ReceivedPlan } | { ok: false; status: number; message: string };

export interface ReceiveReply {
  status: number;
  body: { ok: boolean; received?: number; skipped?: number; message: string };
}

/** コードを、大文字の英数字だけにそろえる。GPT が「LH-ABCD-…」と区切り付きで渡してもよいように。 */
export function normalizeCode(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // 2/30 のような実在しない日は、日付として通さない(Date が繰り上げた日と食い違う)。
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/**
 * 予定の配列を、日程として使える形だけに絞って、日程表と同じ並び(日付→時刻)にする。
 * 日付か題名が読めない予定は捨てて、捨てた数を返す。送信コード版(parseReceivedPlan)と、
 * ログイン版の MCP ツール(api/mcp.ts)の両方が使う — 検証を入り口ごとに作り直さない。
 * 金額は受け取らない(GPT の見積もりが旅行の費用に積まれないように)。
 */
export function parseItems(rawItems: unknown[]): { items: ReceivedItem[]; skipped: number } {
  const items: ReceivedItem[] = [];
  let skipped = 0;
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }
    const row = raw as Record<string, unknown>;
    const date = normalizeDate(row.date);
    const title = text(row.title, 120);
    // 日付と題名が無い予定は、日程表に置きようがない。
    if (!date || !title) {
      skipped++;
      continue;
    }
    const startTime = normalizeTime(row.startTime);
    // 開始より前の終了時刻は読み違え。日をまたぐ予定は、翌日ぶんを別の予定にしてもらう。
    const endRaw = normalizeTime(row.endTime);
    const endTime = endRaw && startTime && endRaw < startTime ? undefined : endRaw;
    const type = TYPES.includes(row.type as ItemType) ? (row.type as ItemType) : "other";
    const location = text(row.location, 120);
    items.push({
      date,
      startTime,
      endTime,
      title,
      location,
      // 到着地は移動のものだけ。宿や観光に付いてきた分は、同じ場所が2度出るだけなので落とす。
      endLocation: type === "transport" ? text(row.endLocation, 120) : undefined,
      memo: text(row.memo, 300),
      type,
    });
  }

  // 日程表と同じ並び(日付→時刻)にする。
  items.sort((a, b) => (a.date === b.date ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.date.localeCompare(b.date)));
  return { items, skipped };
}

/** 受け取った本文を検証して、受信箱へ置く形にする。駄目な時は GPT がそのまま伝えられる理由を返す。 */
export function parseReceivedPlan(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, message: "送る内容を読み取れませんでした。code と items を付けて送ってください。" };
  }
  const value = body as Record<string, unknown>;

  const code = normalizeCode(value.code);
  if (!code) {
    return {
      ok: false,
      status: 400,
      message: "送信コードがありません。LIFE HUB の「ChatGPTで旅程を作ってもらう」に出るコードを、ユーザーに聞いてください。",
    };
  }

  if (!Array.isArray(value.items) || value.items.length === 0) {
    return { ok: false, status: 400, message: "旅程の items が空です。日付と題名のある予定を1件以上入れてください。" };
  }
  if (value.items.length > MAX_ITEMS) {
    return {
      ok: false,
      status: 400,
      message: `一度に送れるのは${MAX_ITEMS}件までです。旅程を前半と後半に分けて、2回に分けて送ってください。`,
    };
  }

  const { items, skipped } = parseItems(value.items);

  if (items.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "日付(YYYY-MM-DD)と題名が読み取れた予定がありませんでした。date と title を入れてください。",
    };
  }

  return {
    ok: true,
    plan: {
      code,
      tripName: text(value.tripName, 100),
      startDate: normalizeDate(value.startDate),
      endDate: normalizeDate(value.endDate),
      items,
      skipped,
    },
  };
}

/** Supabase の関数 receive_chatgpt_trip の応答を、GPT へ返す応答にする。 */
export function interpretRpcResult(status: number, data: unknown, plan: ReceivedPlan): ReceiveReply {
  // 関数がまだ無い(027のSQLを流す前)。LIFE HUB 側の準備の問題で、GPT やユーザーの誤りではない。
  if (status === 404) {
    return {
      status: 503,
      body: { ok: false, message: "LIFE HUB 側の準備がまだ終わっていません。しばらくしてからもう一度お試しください。" },
    };
  }
  if (status < 200 || status >= 300 || !data || typeof data !== "object") {
    return {
      status: 502,
      body: { ok: false, message: "LIFE HUB に届けられませんでした。しばらくしてからもう一度お試しください。" },
    };
  }
  const result = data as { ok?: unknown; reason?: unknown };
  if (result.ok === true) {
    const skippedNote = plan.skipped > 0 ? `(日付か題名が読めなかった${plan.skipped}件は除きました)` : "";
    return {
      status: 200,
      body: {
        ok: true,
        received: plan.items.length,
        skipped: plan.skipped,
        message: `LIFE HUB の受信箱に${plan.items.length}件を届けました${skippedNote}。LIFE HUB を開き、旅行の「日程」→「写真・文章から追加・更新」の一番上に出る「ChatGPTから届いた旅程」で、内容を確かめてから入れてください。`,
      },
    };
  }
  if (result.reason === "invalid_code") {
    return {
      status: 401,
      body: {
        ok: false,
        message: "送信コードが違うか、すでに無効です。LIFE HUB の「ChatGPTで旅程を作ってもらう」に出るコードを、ユーザーにもう一度聞いてください。",
      },
    };
  }
  return { status: 400, body: { ok: false, message: "旅程の件数か大きさが上限を超えています。分けて送ってください。" } };
}

/**
 * 受け取った本文を検証して、Supabase の関数 receive_chatgpt_trip で受信箱へ置く。
 * HTTP の受け口(下の handler)と、MCP の受け口(mcp.ts)の両方がこれを呼ぶ — 検証・件数の上限・
 * 「金額は受け取らない」を、入り口ごとに作り直さないため。公開鍵(anon)だけで呼ぶ。
 */
export async function deliverTripPlan(payload: unknown): Promise<ReceiveReply> {
  const parsed = parseReceivedPlan(payload);
  if (!parsed.ok) {
    return { status: parsed.status, body: { ok: false, message: parsed.message } };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { status: 503, body: { ok: false, message: "LIFE HUB 側の接続設定がありません。" } };
  }

  const { plan } = parsed;
  let rpcStatus: number;
  let rpcData: unknown;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/receive_chatgpt_trip`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({
        p_code: plan.code,
        p_trip_name: plan.tripName ?? null,
        p_start_date: plan.startDate ?? null,
        p_end_date: plan.endDate ?? null,
        p_items: plan.items,
      }),
    });
    rpcStatus = response.status;
    rpcData = await response.json().catch(() => null);
  } catch {
    return { status: 502, body: { ok: false, message: "LIFE HUB に届けられませんでした。しばらくしてからもう一度お試しください。" } };
  }

  return interpretRpcResult(rpcStatus, rpcData, plan);
}

// @vercel-handler
function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  res.status(statusCode).json(body);
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { ok: false, message: "Method not allowed" });
  }

  let payload: unknown;
  try {
    payload = req.body ?? {};
    if (typeof payload === "string") payload = JSON.parse(payload);
  } catch {
    return jsonResponse(res, 400, { ok: false, message: "送る内容がJSONとして読めませんでした。" });
  }

  const reply = await deliverTripPlan(payload);
  return jsonResponse(res, reply.status, reply.body);
};
