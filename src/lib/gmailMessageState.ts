import { db } from "../db/schema";
import type { SyncedEmail } from "../types";
import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";

/** メールの「既読」「重要」「送信済み」だけを端末間で揃える(supabase/sql/011_gmail_message_state.sql)。
 *
 * db.syncedEmails は汎用同期エンジン(src/lib/sync.ts)の対象外で、これからも入れない —
 * 行IDも accountId も端末ごとのローカルUUIDで他端末では意味を持たないうえ、件名・
 * スニペット・AI下書き本文といったメールの中身をクラウドに置きたくないため。代わりに
 * どの端末でも同じ値になる Gmail のメッセージIDをキーに、状態だけをやり取りする。
 *
 * 競合は updated_at の新しい方を採用する(last-write-wins)。ローカル側の対になる値が
 * SyncedEmail.stateUpdatedAt。 */
interface RemoteState {
  gmail_message_id: string;
  read_at: string | null;
  important_at: string | null;
  sent: boolean;
  updated_at: string;
}

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await auth.getSession();
  return data.session?.user.id ?? null;
}

const CONFLICT_TARGET = "user_id,account_email,gmail_message_id";

/** 同期の結果。件数と、失敗した場合のメッセージ。呼び出し側(GmailInbox)がそのまま
 * トーストに出せるようにしてある — 以前はconsoleにしか出しておらず、テーブル未作成や
 * 権限エラーで一切揃っていない時に、画面上は成功と見分けが付かなかった。 */
export interface MessageStateSyncResult {
  count: number;
  error: string | null;
}

function stateRow(userId: string, accountEmail: string, email: SyncedEmail, updatedAt: number) {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    account_email: accountEmail,
    gmail_message_id: email.gmailMessageId,
    read_at: email.readAt ? new Date(email.readAt).toISOString() : null,
    important_at: email.importantAt ? new Date(email.importantAt).toISOString() : null,
    sent: email.status === "sent",
    updated_at: new Date(updatedAt).toISOString(),
  };
}

/** ブロック中送信者の push と同じく best-effort — 失敗してもローカルの操作は成立している
 * ので、例外は投げずに握りつぶす(次に同じ操作をした時、または他端末からのpullで揃う)。 */
export async function pushMessageState(accountEmail: string, email: SyncedEmail): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase
    .from("gmail_message_state")
    .upsert(stateRow(userId, accountEmail, email, email.stateUpdatedAt ?? Date.now()), { onConflict: CONFLICT_TARGET });
  if (error) console.error("[gmailMessageState] failed to push state to Supabase:", error.message);
}

/** この仕組みができる前から端末に溜まっていた既読・送信済みを、まとめてサーバーに送る。
 *
 * stateUpdatedAt はこの機能で追加したフィールドなので、過去に既読にしたメールは
 * すべて未設定のまま = 一度もサーバーに送られない。それだと「これから既読にした分」
 * しか揃わず、今ある既読はいつまでも端末ごとにバラバラのままになる。
 *
 * updated_at には「実際に読んだ時刻」を入れる(送信済みだけの行は取り込んだ時刻)。
 * 今の時刻にすると、他端末で後から未読に戻した操作をこの backfill が押し戻してしまう。 */
export async function pushPendingMessageStates(accountId: string, accountEmail: string): Promise<MessageStateSyncResult> {
  const userId = await currentUserId();
  if (!userId) return { count: 0, error: null };
  const local = await db.syncedEmails.where("accountId").equals(accountId).toArray();
  const pending = local.filter(
    (e) => e.id && e.stateUpdatedAt == null && (e.readAt != null || e.importantAt != null || e.status === "sent"),
  );
  if (pending.length === 0) return { count: 0, error: null };

  const stamps = new Map(pending.map((e) => [e.id!, e.readAt ?? e.createdAt]));
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase
    .from("gmail_message_state")
    .upsert(pending.map((e) => stateRow(userId, accountEmail, e, stamps.get(e.id!)!)), { onConflict: CONFLICT_TARGET });
  if (error) {
    console.error("[gmailMessageState] failed to push pending states to Supabase:", error.message);
    return { count: 0, error: error.message };
  }
  for (const email of pending) await db.syncedEmails.update(email.id!, { stateUpdatedAt: stamps.get(email.id!) });
  return { count: pending.length, error: null };
}

/** ローカルの既読/送信済みを更新し、その変更を他端末にも配る。呼び出し側は
 * これ1本で「押した時だけ既読にする」操作を完結できる。 */
export async function updateMessageState(
  accountEmail: string,
  email: SyncedEmail,
  changes: { readAt?: number | undefined; importantAt?: number | undefined; status?: SyncedEmail["status"] },
): Promise<void> {
  if (!email.id) return;
  const stateUpdatedAt = Date.now();
  await db.syncedEmails.update(email.id, { ...changes, stateUpdatedAt });
  void pushMessageState(accountEmail, { ...email, ...changes, stateUpdatedAt });
}

/** 他端末での既読/未読/送信済みをこの端末に取り込む。ローカルに無いメッセージIDの行は
 * 無視する — 一覧そのものは各端末がGmailから取り直すので、状態だけ先に届いても
 * 入れる場所が無い(次の同期でメールが入った後、もう一度pullすれば反映される)。 */
export async function pullMessageStates(accountId: string, accountEmail: string): Promise<MessageStateSyncResult> {
  const userId = await currentUserId();
  if (!userId) return { count: 0, error: null };
  const supabase = await getSupabaseDataClient();
  const { data, error } = await supabase
    .from("gmail_message_state")
    .select("gmail_message_id, read_at, important_at, sent, updated_at")
    .eq("user_id", userId)
    .eq("account_email", accountEmail);
  if (error) {
    console.error("[gmailMessageState] failed to pull states from Supabase:", error.message);
    return { count: 0, error: error.message };
  }

  const local = await db.syncedEmails.where("accountId").equals(accountId).toArray();
  const byMessageId = new Map(local.map((e) => [e.gmailMessageId, e]));
  let applied = 0;

  for (const remote of (data ?? []) as RemoteState[]) {
    const email = byMessageId.get(remote.gmail_message_id);
    if (!email?.id) continue;
    const remoteUpdatedAt = new Date(remote.updated_at).getTime();
    if (Number.isNaN(remoteUpdatedAt)) continue;
    // 自分の方が新しい(または同時刻)なら触らない。次のpushでサーバー側が揃う。
    if ((email.stateUpdatedAt ?? 0) >= remoteUpdatedAt) continue;

    const readAt = remote.read_at ? new Date(remote.read_at).getTime() : undefined;
    const importantAt = remote.important_at ? new Date(remote.important_at).getTime() : undefined;
    const changes: Partial<SyncedEmail> = { readAt, importantAt, stateUpdatedAt: remoteUpdatedAt };
    // 送信済みは「取り消す」方向には動かさない — このアプリから実際に送った履歴
    // (ローカルのdraftReplies.sentAt)が残っている端末で、それと食い違うのを避ける。
    if (remote.sent && email.status !== "sent") changes.status = "sent";
    await db.syncedEmails.update(email.id, changes);
    applied++;
  }
  return { count: applied, error: null };
}
