import { db } from "../db/schema";
import type { SyncedEmail } from "../types";
import { auth, isSupabaseConfigured } from "./supabase";
import { getSupabaseDataClient } from "./supabaseData";

/** メールの「既読」「送信済み」だけを端末間で揃える(supabase/sql/011_gmail_message_state.sql)。
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
  sent: boolean;
  updated_at: string;
}

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await auth.getSession();
  return data.session?.user.id ?? null;
}

/** ブロック中送信者の push と同じく best-effort — 失敗してもローカルの操作は成立している
 * ので、例外は投げずに握りつぶす(次に同じ操作をした時、または他端末からのpullで揃う)。 */
export async function pushMessageState(accountEmail: string, email: SyncedEmail): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { error } = await supabase.from("gmail_message_state").upsert(
    {
      id: crypto.randomUUID(),
      user_id: userId,
      account_email: accountEmail,
      gmail_message_id: email.gmailMessageId,
      read_at: email.readAt ? new Date(email.readAt).toISOString() : null,
      sent: email.status === "sent",
      updated_at: new Date(email.stateUpdatedAt ?? Date.now()).toISOString(),
    },
    { onConflict: "user_id,account_email,gmail_message_id" },
  );
  if (error) console.error("[gmailMessageState] failed to push state to Supabase:", error.message);
}

/** ローカルの既読/送信済みを更新し、その変更を他端末にも配る。呼び出し側は
 * これ1本で「押した時だけ既読にする」操作を完結できる。 */
export async function updateMessageState(
  accountEmail: string,
  email: SyncedEmail,
  changes: { readAt?: number | undefined; status?: SyncedEmail["status"] },
): Promise<void> {
  if (!email.id) return;
  const stateUpdatedAt = Date.now();
  await db.syncedEmails.update(email.id, { ...changes, stateUpdatedAt });
  void pushMessageState(accountEmail, { ...email, ...changes, stateUpdatedAt });
}

/** 他端末での既読/未読/送信済みをこの端末に取り込む。ローカルに無いメッセージIDの行は
 * 無視する — 一覧そのものは各端末がGmailから取り直すので、状態だけ先に届いても
 * 入れる場所が無い(次の同期でメールが入った後、もう一度pullすれば反映される)。 */
export async function pullMessageStates(accountId: string, accountEmail: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await getSupabaseDataClient();
  const { data, error } = await supabase
    .from("gmail_message_state")
    .select("gmail_message_id, read_at, sent, updated_at")
    .eq("user_id", userId)
    .eq("account_email", accountEmail);
  if (error) {
    console.error("[gmailMessageState] failed to pull states from Supabase:", error.message);
    return;
  }

  const local = await db.syncedEmails.where("accountId").equals(accountId).toArray();
  const byMessageId = new Map(local.map((e) => [e.gmailMessageId, e]));

  for (const remote of (data ?? []) as RemoteState[]) {
    const email = byMessageId.get(remote.gmail_message_id);
    if (!email?.id) continue;
    const remoteUpdatedAt = new Date(remote.updated_at).getTime();
    if (Number.isNaN(remoteUpdatedAt)) continue;
    // 自分の方が新しい(または同時刻)なら触らない。次のpushでサーバー側が揃う。
    if ((email.stateUpdatedAt ?? 0) >= remoteUpdatedAt) continue;

    const readAt = remote.read_at ? new Date(remote.read_at).getTime() : undefined;
    const changes: Partial<SyncedEmail> = { readAt, stateUpdatedAt: remoteUpdatedAt };
    // 送信済みは「取り消す」方向には動かさない — このアプリから実際に送った履歴
    // (ローカルのdraftReplies.sentAt)が残っている端末で、それと食い違うのを避ける。
    if (remote.sent && email.status !== "sent") changes.status = "sent";
    await db.syncedEmails.update(email.id, changes);
  }
}
