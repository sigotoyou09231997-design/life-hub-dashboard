/**
 * 旅行を、ほかのアカウントと一緒に編集する(supabase/sql/034_trip_members.sql)ための、招待・参加・抜ける。
 *
 * 名前に注意: 旅行の「参加者の名前」(Trip.members、割り勘用。src/lib/tripMembers.ts)とは別のもの。
 * こちらは**ログインしている別のアカウント**を招き、旅行のデータを一緒に読み書きする仕組み。
 *
 * 招待と参加者の一覧は、端末の中(Dexie)ではなく Supabase にしかない。023 の共有リンクと同じ作りで、開くたびに
 * 読みに行く — 「外した直後から見られない」を確かにするには、送信待ちの状態を作らないのが確実なため。
 * 旅行の中身(日程・持ち物・ルート・費用)の同期は、src/lib/sync.ts が受け持つ。
 */
import { auth } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";
import { notifyTripMembersChanged } from "./sharedTrips";

export interface Collaborator {
  /** trip_members の行の id(外す・取り消すのときに使う)。 */
  id: string;
  tripId: string;
  ownerId: string;
  /** 旅行の持ち主のメールアドレス。 */
  ownerEmail: string;
  invitedEmail: string;
  /** 参加している人。承認待ちの間は null。 */
  memberId: string | null;
  status: "pending" | "accepted";
  /** 招待した時点の旅行(招かれた人は、参加するまで旅行そのものを読めないので、行に控えてある)。 */
  tripName: string;
  tripDestination: string;
  tripStartDate: string | null;
  tripEndDate: string | null;
  invitedAt: string;
}

interface CollaboratorRow {
  id: string;
  trip_id: string;
  owner_id: string;
  owner_email: string | null;
  invited_email: string;
  member_id: string | null;
  status: string;
  trip_name: string | null;
  trip_destination: string | null;
  trip_start_date: string | null;
  trip_end_date: string | null;
  invited_at: string;
}

export function rowToCollaborator(row: CollaboratorRow): Collaborator {
  return {
    id: row.id,
    tripId: row.trip_id,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email ?? "",
    invitedEmail: row.invited_email,
    memberId: row.member_id,
    status: row.status === "accepted" ? "accepted" : "pending",
    tripName: row.trip_name ?? "",
    tripDestination: row.trip_destination ?? "",
    tripStartDate: row.trip_start_date,
    tripEndDate: row.trip_end_date,
    invitedAt: row.invited_at,
  };
}

/** 失敗の種類。サーバーの関数が message に入れる短い印(034)と、通信まわりの失敗をまとめたもの。 */
export type CollabFailure =
  | "unavailable" // 034 がまだ流れていない
  | "offline" // 通信できない
  | "login_required"
  | "not_allowed"
  | "trip_not_found"
  | "invalid_email"
  | "self_invite"
  | "too_many_members"
  | "invite_not_found"
  | "unknown";

export class CollabError extends Error {
  constructor(
    readonly failure: CollabFailure,
    detail?: string,
  ) {
    super(detail ?? failure);
    this.name = "CollabError";
  }
}

const KNOWN_FAILURES: CollabFailure[] = [
  "login_required",
  "not_allowed",
  "trip_not_found",
  "invalid_email",
  "self_invite",
  "too_many_members",
  "invite_not_found",
];

/** Supabase のエラー(PostgrestError など)を、種類に分ける。 */
export function classifyCollabError(error: unknown): CollabFailure {
  const e = error as { code?: unknown; message?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  const known = KNOWN_FAILURES.find((name) => message === name || message.includes(name));
  if (known) return known;
  const code = typeof e?.code === "string" ? e.code : "";
  // 034 が無い: 関数が無い(PGRST202)・表が無い(42P01 / PGRST205 / PGRST200)。
  if (["PGRST202", "PGRST205", "PGRST200", "42P01", "42883"].includes(code) || /does not exist|could not find the (function|table)/i.test(message)) {
    return "unavailable";
  }
  // 通信の失敗は PostgrestError の形で来るが、code が空になる(src/lib/sync.ts の isTransientPushError と同じ見分け方)。
  if (code === "" && /fetch|network|load failed/i.test(message)) return "offline";
  return "unknown";
}

const FAILURE_TEXT: Record<CollabFailure, string> = {
  unavailable: "この機能は、まだ使えません（準備中です）",
  offline: "通信できませんでした。電波のある所でもう一度お試しください",
  login_required: "ログインし直してください",
  not_allowed: "この操作はできません",
  trip_not_found: "この旅行が見つかりません。まだ同期されていないか、消されています。同期してからもう一度お試しください",
  invalid_email: "メールアドレスの形が正しくありません",
  self_invite: "自分のメールアドレスは招待できません",
  too_many_members: "参加者は10人までです",
  invite_not_found: "この招待は見つかりません。取り消されたか、すでに済んでいます",
  unknown: "うまくいきませんでした。少し待ってからもう一度お試しください",
};

export function describeCollabFailure(failure: CollabFailure): string {
  return FAILURE_TEXT[failure];
}

function toError(error: unknown): CollabError {
  if (error instanceof CollabError) return error;
  const failure = classifyCollabError(error);
  if (failure === "unknown") console.error("[tripCollab] unexpected error:", error);
  return new CollabError(failure, (error as { message?: string } | null)?.message);
}

/** 画面に出す文。CollabError でなくても、それらしい文にする。 */
export function collabErrorText(error: unknown): string {
  return describeCollabFailure(error instanceof CollabError ? error.failure : classifyCollabError(error));
}

/** 画面に出すメールアドレス。全部は出さず、頭の2文字と @ のあとだけ見せる(2026-10-13、本人「招待してるアカウントは
 * 非表示にして」)。人の名前を持っていないので、誰か見分けられる程度に隠す。招待の案内文(inviteMessage)や、
 * 相手に送る入力欄では、本物のアドレスのまま使う。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const keep = local.length >= 3 ? 2 : 1;
  return `${local.slice(0, keep)}***${email.slice(at)}`;
}

/** 招待先のメールアドレスの形。サーバー(invite_trip_member)と同じ決まり。 */
export function normalizeInviteEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidInviteEmail(input: string): boolean {
  const email = normalizeInviteEmail(input);
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  try {
    const client = await getSupabaseDataClient();
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data as T;
  } catch (error) {
    throw toError(error);
  }
}

/** この旅行の招待・参加者。持ち主は承認待ちも含めて全員、参加中の人は参加中の人だけが見える(RLS)。 */
export async function listCollaborators(tripId: string): Promise<Collaborator[]> {
  try {
    const client = await getSupabaseDataClient();
    const { data, error } = await client.from("trip_members").select("*").eq("trip_id", tripId).order("invited_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as CollaboratorRow[]).map(rowToCollaborator);
  } catch (error) {
    throw toError(error);
  }
}

/** 自分宛ての、承認待ちの招待。034 が無い・通信できない時は、空(画面に何も出さない)。 */
export async function listIncomingInvites(): Promise<Collaborator[]> {
  try {
    const userId = (await auth.getSession()).data.session?.user.id;
    if (!userId) return [];
    const client = await getSupabaseDataClient();
    const { data, error } = await client.from("trip_members").select("*").eq("status", "pending").order("invited_at", { ascending: false });
    if (error) return [];
    // 承認待ちで見える行は、自分が出した招待(持ち主として)と、自分宛て。後者だけ。
    return ((data ?? []) as CollaboratorRow[]).map(rowToCollaborator).filter((invite) => invite.ownerId !== userId);
  } catch {
    return [];
  }
}

export async function inviteCollaborator(tripId: string, email: string): Promise<{ id: string; alreadyInvited: boolean }> {
  const result = await rpc<{ id: string; alreadyInvited: boolean }>("invite_trip_member", { p_trip_id: tripId, p_email: normalizeInviteEmail(email) });
  notifyTripMembersChanged();
  return result;
}

/** 招待に答える。参加したら、その旅行をすぐ取り込む。 */
export async function respondToInvite(tripId: string, accept: boolean): Promise<void> {
  await rpc("respond_trip_invite", { p_trip_id: tripId, p_accept: accept });
  notifyTripMembersChanged();
  if (accept) await refreshAfterMembershipChange();
}

/** 持ち主が、参加者を外す／承認待ちの招待を取り消す。 */
export async function removeCollaborator(rowId: string): Promise<void> {
  await rpc("remove_trip_member", { p_member_row_id: rowId });
  notifyTripMembersChanged();
}

/** 参加した人が、自分から抜ける。この端末の旅行も、すぐ片付ける。 */
export async function leaveSharedTrip(tripId: string): Promise<void> {
  await rpc("leave_trip", { p_trip_id: tripId });
  notifyTripMembersChanged();
  await refreshAfterMembershipChange();
}

async function refreshAfterMembershipChange(): Promise<void> {
  try {
    const { refreshSharedTrips } = await import("./syncRuntime");
    await refreshSharedTrips();
  } catch (error) {
    // 参加・抜けるそのものはサーバーで済んでいる。端末への反映は、次の同期でも追いつく。
    console.error("[tripCollab] failed to refresh the shared trips:", error);
  }
}

/** 招待を伝えるときに添える文(相手に、どのアドレスでログインすればいいかを伝える)。 */
export function inviteMessage(tripName: string, email: string, origin: string = window.location.origin): string {
  return `LIFE HUB の旅行「${tripName}」に招待しました。\n${origin} を開いて、${email} でログインすると、「参加する」が出ます。`;
}
