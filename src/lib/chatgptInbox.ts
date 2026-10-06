/**
 * ChatGPT(専用GPT)から直接送られた旅程の受信箱(supabase/sql/027_chatgpt_trip_inbox.sql)。
 *
 * 他の旅行データと違って**端末内(Dexie)を経由しない**。送信コードも受信箱も Supabase を
 * 直接読み書きする(src/lib/tripShare.ts と同じ作り)。GPT が送ってくる先がサーバーで、
 * 端末に置いても同期に載せる意味が無いため。
 *
 * 送信コード: 人ごとの乱数のコード。専用GPTは配った全員で1つの設定しか持てないので、
 * 「誰の LIFE HUB か」を見分ける印にする。コードでできるのは、その人の受信箱へ旅程を置くことだけ
 * (日程や日記は読めない)。表にはコードそのものを置かず、SHA-256 の値だけを置く。
 *
 * 受信箱の旅程は**そのまま日程に入れない**。読み取りと同じ確認画面(TripPlanScanForm)を通す。
 */
import type { ExtractedTripItem } from "./mailPlanImport";
import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";
import { isValidDateStr } from "./date";

/** 専用GPTの共有リンク。作ってリンクができたら、ここへ入れる(空の間は、アプリに「開く」ボタンを出さない)。 */
export const CHATGPT_GPT_URL = "";

/** 紛らわしい I・O・0・1 を除いた32文字。32は2の累乗なので、1バイトの下位5bitで偏りなく選べる。 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PREFIX = "LH";
/** 20文字 × 5bit = 100bit。当てずっぽうでは当たらない。 */
const CODE_LENGTH = 20;
const STORAGE_KEY = "lifehub.chatgptSendCode";

/** コードを、大文字の英数字だけにそろえる。サーバー(api/receiveTripPlan.ts の normalizeCode)と同じ規則。 */
export function normalizeSendCode(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 新しい送信コード(正規化した形。LH + 20文字)。 */
export function newSendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let body = "";
  for (const byte of bytes) body += CODE_ALPHABET[byte & 31];
  return `${CODE_PREFIX}${body}`;
}

/** 読み書きしやすい区切り付き。「LH-ABCD-EFGH-JKLM-NPQR-STUV」。 */
export function formatSendCode(code: string): string {
  const normalized = normalizeSendCode(code);
  const groups = [normalized.slice(0, 2), ...(normalized.slice(2).match(/.{1,4}/g) ?? [])];
  return groups.join("-");
}

/** 表に置く値。正規化したコードの SHA-256 を16進(小文字)で。Supabase の関数側と同じ計算。 */
export async function hashSendCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizeSendCode(code)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SendCodeState =
  /** ログインしていない・Supabase が未設定・SQL(027)をまだ流していない。この機能は出さない。 */
  | { kind: "unavailable" }
  | { kind: "none" }
  /** code は、この端末で作った時だけ分かる(表には値の要約しか無い)。別の端末では作り直す。 */
  | { kind: "active"; createdAt: string; code?: string };

export interface InboxEntry {
  id: string;
  tripName?: string;
  startDate?: string;
  endDate?: string;
  /** 受け取った時刻(ミリ秒)。 */
  receivedAt: number;
  items: ExtractedTripItem[];
}

/** 表・関数がまだ無い時の応答か(SQLを流す前)。そのときは機能ごと隠す。 */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && ["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

const ITEM_TYPES = ["transport", "lodging", "meal", "sightseeing", "other"] as const;

function short(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function timeOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : undefined;
}

/**
 * 受信箱の中身を、日程として使える形だけに絞る。サーバー側でも検証しているが、
 * この表に入った値を信用しない(人が作ったコードで誰でも置ける入り口のため)。金額は受け取らない。
 */
export function parseInboxItems(raw: unknown): ExtractedTripItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ExtractedTripItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const date = typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && isValidDateStr(value.date) ? value.date : undefined;
    const title = short(value.title, 120);
    if (!date || !title) continue;
    const type = ITEM_TYPES.includes(value.type as (typeof ITEM_TYPES)[number]) ? (value.type as ExtractedTripItem["type"]) : "other";
    const startTime = timeOrUndefined(value.startTime);
    const endRaw = timeOrUndefined(value.endTime);
    items.push({
      date,
      startTime,
      endTime: endRaw && startTime && endRaw < startTime ? undefined : endRaw,
      title,
      location: short(value.location, 120),
      endLocation: type === "transport" ? short(value.endLocation, 120) : undefined,
      memo: short(value.memo, 300),
      type,
    });
  }
  return items;
}

async function currentUserId(): Promise<string | undefined> {
  if (!isSupabaseConfigured) return undefined;
  return (await auth.getSession()).data.session?.user.id;
}

function readStoredCode(userId: string): string | undefined {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null") as { userId?: string; code?: string } | null;
    return stored?.userId === userId && typeof stored.code === "string" ? stored.code : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredCode(userId: string, code: string | null): void {
  try {
    if (code === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ userId, code }));
  } catch {
    // 書けない環境では、作った直後にだけ見える(あとで見たい時は作り直す)。
  }
}

/** 送信コードの今の状態。読めなければ、機能を隠すだけで落ちない(任意の機能のため)。 */
export async function loadSendCodeState(): Promise<SendCodeState> {
  try {
    const userId = await currentUserId();
    if (!userId) return { kind: "unavailable" };
    const client = await getSupabaseDataClient();
    const { data, error } = await client.from("chatgpt_send_codes").select("code_hash, created_at").maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.warn("[chatgptInbox] could not read the send code:", error.message);
      return { kind: "unavailable" };
    }
    if (!data) return { kind: "none" };
    // この端末に控えがあっても、作り直された後の古いコードなら見せない(表の値と合う時だけ)。
    const stored = readStoredCode(userId);
    const code = stored && (await hashSendCode(stored)) === data.code_hash ? formatSendCode(stored) : undefined;
    return { kind: "active", createdAt: data.created_at, code };
  } catch (err) {
    console.warn("[chatgptInbox] could not read the send code:", err);
    return { kind: "unavailable" };
  }
}

/** 送信コードを作る(すでにあれば作り直す — 古いコードは、この瞬間から使えない)。 */
export async function createSendCode(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw new Error("ログインしていないため作れません");
  const code = newSendCode();
  const client = await getSupabaseDataClient();
  const { error } = await client
    .from("chatgpt_send_codes")
    .upsert({ user_id: userId, code_hash: await hashSendCode(code), created_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  writeStoredCode(userId, code);
  return formatSendCode(code);
}

/** 送信コードを無効にする(行ごと消す)。配ったコードは、この瞬間から受け付けられなくなる。 */
export async function revokeSendCode(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("ログインしていないため操作できません");
  const client = await getSupabaseDataClient();
  const { error } = await client.from("chatgpt_send_codes").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
  writeStoredCode(userId, null);
}

/** 受信箱に届いている旅程(新しい順)。読めなければ空。 */
export async function loadInbox(): Promise<InboxEntry[]> {
  try {
    if (!(await currentUserId())) return [];
    const client = await getSupabaseDataClient();
    const { data, error } = await client
      .from("chatgpt_trip_inbox")
      .select("id, trip_name, start_date, end_date, items, received_at")
      .order("received_at", { ascending: false });
    if (error) {
      if (!isMissingTable(error)) console.warn("[chatgptInbox] could not read the inbox:", error.message);
      return [];
    }
    return (data ?? [])
      .map((row) => ({
        id: row.id as string,
        tripName: short(row.trip_name, 100),
        startDate: typeof row.start_date === "string" ? row.start_date : undefined,
        endDate: typeof row.end_date === "string" ? row.end_date : undefined,
        receivedAt: Date.parse(row.received_at as string),
        items: parseInboxItems(row.items),
      }))
      .filter((entry) => entry.items.length > 0);
  } catch (err) {
    console.warn("[chatgptInbox] could not read the inbox:", err);
    return [];
  }
}

/** 受信箱から1件消す(日程に入れた後・要らない時)。 */
export async function deleteInboxEntry(id: string): Promise<void> {
  const client = await getSupabaseDataClient();
  const { error } = await client.from("chatgpt_trip_inbox").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
