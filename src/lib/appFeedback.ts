import { auth, getSupabaseConfig, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";
import { isMissingTable } from "./chatgptInbox";

/**
 * 自分以外の人が「ここ直した方がいい」を送る、要望の受信箱(supabase/sql/029_app_feedback.sql)。
 *
 * * 送る: ログインしている人は誰でも。共有した「しおり」を見ている人は、その共有リンクの合鍵つきで。
 * * 読む: アプリの持ち主だけ(設定の「届いた要望」)。持ち主の Mac からは読み取りコードで
 *   (scripts/feedback-inbox.mjs)。
 *
 * 表は同期しない(端末の Dexie を経由せず、Supabase を直接読み書きする)。通信できない時は送れない。
 */

export type FeedbackStatus = "new" | "done" | "dismissed";

export interface FeedbackItem {
  id: string;
  via: "app" | "share";
  senderName?: string;
  tripName?: string;
  page?: string;
  message: string;
  appVersion?: string;
  status: FeedbackStatus;
  createdAt: string;
}

export type FeedbackFailure = "invalid_message" | "too_many" | "not_allowed" | "invalid_share" | "unavailable" | "failed";

export class FeedbackError extends Error {
  constructor(public readonly reason: FeedbackFailure) {
    super(FEEDBACK_FAILURE_MESSAGE[reason]);
    this.name = "FeedbackError";
  }
}

export const FEEDBACK_FAILURE_MESSAGE: Record<FeedbackFailure, string> = {
  invalid_message: "内容を入れてください(2000字まで)",
  too_many: "続けて送りすぎています。1時間ほどあけて、もう一度お試しください",
  not_allowed: "ログインしてから送ってください",
  invalid_share: "この共有リンクは終わっているため、送れません",
  unavailable: "要望の受け付けは、まだ準備中です",
  failed: "送れませんでした。通信できる場所で、もう一度お試しください",
};

export const FEEDBACK_MAX_LENGTH = 2000;

/** いま動いているアプリの版(vite.config.ts がビルドの時に埋める)。古い版のまま見ている人かを見分ける。 */
export function currentAppVersion(): string {
  return typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__.slice(0, 7) : "";
}

interface SendInput {
  message: string;
  /** どの画面で書いたか(アプリの道筋)。 */
  page?: string;
  senderName?: string;
  /** 共有した「しおり」のページから送る時の合鍵。ログインしていなくても送れる。 */
  shareToken?: string;
}

function knownFailure(reason: unknown): FeedbackFailure {
  return typeof reason === "string" && reason in FEEDBACK_FAILURE_MESSAGE ? (reason as FeedbackFailure) : "failed";
}

/**
 * 要望を送る。ログインしていればその人として、していなければ共有リンクの合鍵で送る。
 * 失敗の理由は FeedbackError で返す(画面がそのまま文言を出す)。
 */
export async function sendFeedback(input: SendInput): Promise<void> {
  const message = input.message.trim();
  if (!message || message.length > FEEDBACK_MAX_LENGTH) throw new FeedbackError("invalid_message");
  if (!isSupabaseConfigured) throw new FeedbackError("unavailable");

  const { url, anonKey } = getSupabaseConfig();
  // 共有のページはログインしていない人が開くので、データ用の窓口(ログインが前提)は使わず、
  // 関数を直接叩く。ログインしていればその人の鍵、していなければ公開鍵だけを付ける。
  const accessToken = (await auth.getSession()).data.session?.access_token;
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/send_app_feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${accessToken ?? anonKey}` },
      body: JSON.stringify({
        p_message: message,
        p_page: input.page ?? null,
        p_sender_name: input.senderName?.trim() || null,
        p_app_version: currentAppVersion() || null,
        p_share_token: input.shareToken ?? null,
      }),
    });
  } catch {
    throw new FeedbackError("failed");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new FeedbackError(isMissingTable(body) || response.status === 404 ? "unavailable" : "failed");
  }
  const result = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) throw new FeedbackError(knownFailure(result?.reason));
}

/** ログインしているのがアプリの持ち主か(届いた要望を出すかどうか)。表が無い・確かめられない時は false。 */
export async function loadIsFeedbackOwner(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const userId = (await auth.getSession()).data.session?.user.id;
  if (!userId) return false;
  const client = await getSupabaseDataClient();
  const { data, error } = await client.from("app_feedback_owner").select("user_id").eq("id", "owner").maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.warn("[feedback] failed to check the owner:", error.message);
    return false;
  }
  return (data as { user_id?: string } | null)?.user_id === userId;
}

interface FeedbackRow {
  id: string;
  via: "app" | "share";
  sender_name: string | null;
  trip_name: string | null;
  page: string | null;
  message: string;
  app_version: string | null;
  status: FeedbackStatus;
  created_at: string;
}

export function rowToFeedback(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    via: row.via,
    senderName: row.sender_name ?? undefined,
    tripName: row.trip_name ?? undefined,
    page: row.page ?? undefined,
    message: row.message,
    appVersion: row.app_version ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** 届いた要望(持ち主だけが読める)。新しい順。 */
export async function loadFeedback(): Promise<FeedbackItem[]> {
  const client = await getSupabaseDataClient();
  const { data, error } = await client
    .from("app_feedback")
    .select("id, via, sender_name, trip_name, page, message, app_version, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as FeedbackRow[]).map(rowToFeedback);
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  const client = await getSupabaseDataClient();
  const { error } = await client
    .from("app_feedback")
    .update({ status, resolved_at: status === "new" ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** 名乗りは端末に覚えておく(毎回打たせない)。 */
const NAME_KEY = "lifehub.feedbackName";

export function readFeedbackName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeFeedbackName(name: string): void {
  try {
    if (name.trim()) window.localStorage.setItem(NAME_KEY, name.trim());
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    // 覚えられなくても送れる。
  }
}
