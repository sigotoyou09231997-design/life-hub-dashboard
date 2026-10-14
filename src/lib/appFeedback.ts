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

/**
 * new=対応待ち(まだ手を付けていない) / working=対応中(035) / hold=保留中(036。聞き返している・判断待ち) / done=対応済み / dismissed=見送り。
 * 名前は 2026-10-14 に変えた(本人「『受付済み』だと、対応してるのか分からないから、対応待ち・対応中にしたい」)。
 * 中身の値(new / working …)と、Mac の道具・SQL は変えていない。
 */
export type FeedbackStatus = "new" | "working" | "hold" | "done" | "dismissed";

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "対応待ち",
  working: "対応中",
  hold: "保留中",
  done: "対応済み",
  dismissed: "見送り",
};

/** 画面に出す状態の名前。知らない状態(新しく足された後の古い版)は、対応待ちとして扱う。 */
export function feedbackStatusLabel(status: string): string {
  return STATUS_LABEL[status as FeedbackStatus] ?? STATUS_LABEL.new;
}

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
  /** 付いている画像の枚数(033 を流す前は無い)。画像そのものは loadFeedbackImages で1件ずつ読む。 */
  imageCount?: number;
  /** いつから対応中か(035 を流す前は無い)。status が working の時だけ意味がある。 */
  workingAt?: string;
  /** 保留中の理由・聞きたいこと(036 を流す前は無い)。status が hold の時だけ意味がある。 */
  statusNote?: string;
  /** かかる時間の目安(分。037 を流す前は無い)。直し始める時に付く。ゲージに使う(src/lib/feedbackGauge.ts)。 */
  estimateMinutes?: number;
  /** 保留中の質問の選択肢(039 を流す前は無い)。あれば、送った人はボタンで答えられる。statusNote が質問の文。 */
  questionOptions?: string[];
  /** 送った人が押した答え(039)。答えると、依頼は「対応待ち」に戻る。 */
  answer?: string;
  /** 答えた時刻(039)。 */
  answeredAt?: string;
}

export type FeedbackFailure =
  | "invalid_message"
  | "invalid_images"
  | "too_many"
  | "not_allowed"
  | "invalid_share"
  | "unavailable"
  | "failed";

export class FeedbackError extends Error {
  constructor(public readonly reason: FeedbackFailure) {
    super(FEEDBACK_FAILURE_MESSAGE[reason]);
    this.name = "FeedbackError";
  }
}

export const FEEDBACK_FAILURE_MESSAGE: Record<FeedbackFailure, string> = {
  invalid_message: "内容を入れてください(2000字まで)",
  invalid_images: "画像を送れませんでした。外すか、別の画像でお試しください",
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
  /** 付ける画像(JPEG のデータ URL。src/lib/feedbackImages.ts で縮めたもの)。画像つきの送り方は 033 を流した後だけ使える。 */
  images?: string[];
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
    // 画像つきの時だけ新しい窓口(033)。画像なしは今までの窓口のまま — 033 を流す前でも送れるように。
    const withImages = Boolean(input.images?.length);
    response = await fetch(`${url}/rest/v1/rpc/${withImages ? "send_app_feedback_v2" : "send_app_feedback"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${accessToken ?? anonKey}` },
      body: JSON.stringify({
        p_message: message,
        p_page: input.page ?? null,
        p_sender_name: input.senderName?.trim() || null,
        p_app_version: currentAppVersion() || null,
        p_share_token: input.shareToken ?? null,
        ...(withImages ? { p_images: input.images } : null),
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
  notifyFeedbackChanged();
}

let imagesEnabled: Promise<boolean> | undefined;

/**
 * 「画像を付ける」を出してよいか(033 を流した後だけ true)。流す前に出すと、送った時に失敗するので出さない。
 * 確かめるのは1回だけ(開いている間は覚える)。確かめられなければ false。
 */
export function canAttachImages(): Promise<boolean> {
  if (!isSupabaseConfigured) return Promise.resolve(false);
  imagesEnabled ??= (async () => {
    try {
      const { url, anonKey } = getSupabaseConfig();
      const response = await fetch(`${url}/rest/v1/rpc/app_feedback_images_enabled`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: "{}",
      });
      return response.ok && (await response.json().catch(() => null)) === true;
    } catch {
      return false;
    }
  })();
  return imagesEnabled;
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
  image_count?: number | null;
  working_at?: string | null;
  status_note?: string | null;
  estimate_minutes?: number | null;
  question_options?: unknown;
  answer?: string | null;
  answered_at?: string | null;
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
    imageCount: row.image_count ?? undefined,
    workingAt: row.working_at ?? undefined,
    statusNote: row.status_note ?? undefined,
    estimateMinutes: row.estimate_minutes ?? undefined,
    questionOptions: Array.isArray(row.question_options) ? row.question_options.filter((option): option is string => typeof option === "string") : undefined,
    answer: row.answer ?? undefined,
    answeredAt: row.answered_at ?? undefined,
  };
}

/** あとから足された列(033 の画像の枚数・035 の修正中の時刻)。流す前の本番には無いので、無ければ外して読み直す。 */
const OPTIONAL_COLUMNS = ["image_count", "working_at", "status_note", "estimate_minutes", "question_options", "answer", "answered_at"];
const BASE_COLUMNS = "id, via, sender_name, trip_name, page, message, app_version, status, created_at";

type FeedbackQuery = (columns: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;

/** 列を全部付けて読み、「その列は無い」と返されたら、その列だけ外して読み直す(受信箱が読めなくならないように)。
 * 列が無い時のエラー(code 42703)は、無い列の名前を message に含む。名前が見つからない失敗は、そのまま投げる。 */
async function selectWithOptionalColumns(query: FeedbackQuery): Promise<FeedbackRow[]> {
  const optional = [...OPTIONAL_COLUMNS];
  for (;;) {
    const result = await query([BASE_COLUMNS, ...optional].join(", "));
    if (!result.error) return (result.data ?? []) as FeedbackRow[];
    const message = result.error.message ?? "";
    const missing = optional.find((column) => message.includes(column));
    if (!missing) throw result.error;
    optional.splice(optional.indexOf(missing), 1);
  }
}

/** 届いた要望(持ち主だけが読める)。新しい順。 */
export async function loadFeedback(): Promise<FeedbackItem[]> {
  const client = await getSupabaseDataClient();
  const rows = await selectWithOptionalColumns((columns) =>
    client.from("app_feedback").select(columns).order("created_at", { ascending: false }).limit(200),
  );
  return rows.map(rowToFeedback);
}

/** 画面で状況を見せる範囲(日)。これより古い依頼は、状況の一覧に出さない。 */
const PROGRESS_DAYS = 14;

/**
 * 自分が見られる依頼の、最近のもの(新しい順)。送った人には自分が送ったものだけ、持ち主には全部が返る(RLS)。
 * 「修正中です」を出すために、アプリを開いている間、続けて読み直す(src/lib/feedbackProgress.ts)。
 * ログインしていない・表が無い・通信できない時は空(画面には何も出さない)。
 */
export async function loadRecentFeedback(limit = 10): Promise<FeedbackItem[]> {
  if (!isSupabaseConfigured) return [];
  try {
    const userId = (await auth.getSession()).data.session?.user.id;
    if (!userId) return [];
    const client = await getSupabaseDataClient();
    const since = new Date(Date.now() - PROGRESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const rows = await selectWithOptionalColumns((columns) =>
      client.from("app_feedback").select(columns).gte("created_at", since).order("created_at", { ascending: false }).limit(limit),
    );
    return rows.map(rowToFeedback);
  } catch {
    return [];
  }
}

/** 1件の依頼に付いている画像(JPEG のデータ URL)。持ち主だけが読める。 */
export async function loadFeedbackImages(id: string): Promise<string[]> {
  const client = await getSupabaseDataClient();
  const { data, error } = await client.from("app_feedback").select("images").eq("id", id).maybeSingle();
  if (error) throw error;
  const images = (data as { images?: unknown } | null)?.images;
  return Array.isArray(images) ? images.filter((image): image is string => typeof image === "string" && image.startsWith("data:image/jpeg;base64,")) : [];
}

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<void> {
  const client = await getSupabaseDataClient();
  const inProgress = status === "new" || status === "working" || status === "hold";
  const patch: Record<string, unknown> = { status, resolved_at: inProgress ? null : new Date().toISOString() };
  // 保留の理由は、保留の間だけ。ほかの状態にしたら消す(036)。かかる時間の目安も、進めている間だけ意味があるので、
  // 未対応・保留中・修正中にしたら消す(古い目安のゲージを出さない。終わったあとは、実績と比べるために残す)(037)。
  // どちらも、流す前の本番には列が無い。その時は、無いと言われた列だけ外して更新し直す。
  if (status !== "hold") patch.status_note = null;
  if (inProgress) patch.estimate_minutes = null;
  for (;;) {
    const { error } = await client.from("app_feedback").update(patch).eq("id", id);
    if (!error) break;
    const missing = ["status_note", "estimate_minutes"].find((column) => column in patch && (error.message ?? "").includes(column));
    if (!missing) throw error;
    delete patch[missing];
  }
  notifyFeedbackChanged();
}

/**
 * 保留中の質問(選ぶボタン)に答える(2026-10-14、持ち主「質問者がボタンを押したらその回答がこっちに送信されるように」。supabase/sql/039)。
 * 自分が送った依頼で、保留中で、選択肢にある答えの時だけ通る。通ると、依頼は「対応待ち」に戻り、持ち主の見張りに答えが流れる。
 * 失敗の理由は FeedbackError("failed" / "unavailable")で返す。
 */
export async function answerFeedback(id: string, answer: string): Promise<void> {
  if (!isSupabaseConfigured) throw new FeedbackError("unavailable");
  const accessToken = (await auth.getSession()).data.session?.access_token;
  if (!accessToken) throw new FeedbackError("failed");
  const { url, anonKey } = getSupabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/app_feedback_answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ p_id: id, p_answer: answer }),
    });
  } catch {
    throw new FeedbackError("failed");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new FeedbackError(isMissingTable(body) || response.status === 404 ? "unavailable" : "failed");
  }
  const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
  if (!result?.ok) throw new FeedbackError("failed");
  notifyFeedbackChanged();
}

const changeListeners = new Set<() => void>();

/** 依頼を送った・状態を変えた時に呼ばれる。状況の表示(src/lib/feedbackProgress.ts)が、すぐ読み直す。 */
export function subscribeFeedbackChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function notifyFeedbackChanged(): void {
  for (const listener of changeListeners) listener();
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
