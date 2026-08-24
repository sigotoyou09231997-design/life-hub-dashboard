import { db } from "../db/schema";
import type { EmailStatus, SyncedEmail } from "../types";

/** 同じGmailメッセージの行が2つできてしまった時、どちらを残すかの優先順位。
 * 「送信済み」など先に進んでいる方を残す — 何も手を付けていない方を残すと、
 * 生成済みのAI下書きや送信済みの記録がその場で消えてしまう。 */
const STATUS_RANK: Record<EmailStatus, number> = {
  sent: 5,
  edited: 4,
  drafted: 3,
  generating: 2,
  skipped: 1,
  unprocessed: 0,
};

function smallestDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v != null);
  return defined.length > 0 ? Math.min(...defined) : undefined;
}

function largestDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v != null);
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

export interface MergedDuplicates {
  keep: SyncedEmail;
  extras: SyncedEmail[];
  /** 消す行が持っていた既読情報のうち、残す行に引き継ぐぶん。何も引き継がない時は空。 */
  changes: Partial<SyncedEmail>;
}

/** 同じgmailMessageIdの行の集まりから「残す1行」と「消す行」を決め、消す行が持って
 * いた既読状態を残す行へ引き継ぐための差分を作る。DBには触らない(テストしやすさのため)。
 *
 * 既読(readAt)は、どれか1行にでも付いていれば残す行にも引き継ぐ — 引き継がないと、
 * 一度既読にしたメールが重複解消の後で未読に戻り、「すべて」タブにまた現れてしまう。 */
export function mergeDuplicateEmails(group: SyncedEmail[]): MergedDuplicates {
  const [keep, ...extras] = [...group].sort((a, b) => {
    const byStatus = STATUS_RANK[b.status] - STATUS_RANK[a.status];
    return byStatus !== 0 ? byStatus : a.createdAt - b.createdAt;
  });

  const changes: Partial<SyncedEmail> = {};
  // 実際に読んだ時刻を残したいので、複数あれば早い方を採る。
  const readAt = smallestDefined(group.map((e) => e.readAt));
  if (readAt != null && readAt !== keep.readAt) changes.readAt = readAt;
  // last-write-winsの基準なので、こちらは新しい方(src/lib/gmailMessageState.ts)。
  const stateUpdatedAt = largestDefined(group.map((e) => e.stateUpdatedAt));
  if (stateUpdatedAt != null && stateUpdatedAt !== keep.stateUpdatedAt) changes.stateUpdatedAt = stateUpdatedAt;

  return { keep, extras, changes };
}

/** 1件のメールを、まだ無ければ取り込む。すでにある場合はnullを返す。
 *
 * 「読んでから足す」を別々のawaitでやると、その隙間に別のタブやアカウント統合
 * (src/lib/gmailAccounts.ts)が同じメッセージの行を入れてしまい、同じメールが一覧に
 * 二重で並ぶ。存在確認と追加を1つのDexieトランザクションに入れて、その隙間を無くす
 * (IndexedDBのトランザクションは同じブラウザの別タブとも直列化される)。 */
export async function addEmailIfAbsent(email: SyncedEmail): Promise<string | null> {
  return db.transaction("rw", db.syncedEmails, async () => {
    const existing = await db.syncedEmails
      .where("[accountId+gmailMessageId]")
      .equals([email.accountId, email.gmailMessageId])
      .first();
    if (existing) return null;
    return (await db.syncedEmails.add(email)) as string;
  });
}

/** 同じgmailMessageIdを持つ行を1行にまとめ、消した行数を返す。
 *
 * 重複ができる経路は2つあった: (1) 同期が2つ同時に走った時(GmailInbox側のガードで
 * 塞いだ)、(2) 連携し直しで増えた重複アカウントを1つにまとめる時、両方のアカウントが
 * 別々に取り込んでいた同じメールが、まとめた先で2行になる(src/lib/gmailAccounts.ts)。
 * どちらの経路でも後片付けはここに一本化する。
 *
 * 消す行にAI下書きがぶら下がっていた場合は、残す行がまだ下書きを持っていなければ
 * 付け替える(同じemailIdに2つの下書きがぶら下がるのを避けるため、1つだけ)。 */
export async function dedupeSyncedEmails(accountId: string): Promise<number> {
  const rows = await db.syncedEmails.where("accountId").equals(accountId).toArray();
  const byMessageId = new Map<string, SyncedEmail[]>();
  for (const row of rows) {
    const group = byMessageId.get(row.gmailMessageId);
    if (group) group.push(row);
    else byMessageId.set(row.gmailMessageId, [row]);
  }

  let removed = 0;
  for (const group of byMessageId.values()) {
    if (group.length < 2) continue;
    const { keep, extras, changes } = mergeDuplicateEmails(group);
    if (keep.id && Object.keys(changes).length > 0) await db.syncedEmails.update(keep.id, changes);
    for (const extra of extras) {
      if (!extra.id) continue;
      const extraDrafts = await db.draftReplies.where("emailId").equals(extra.id).toArray();
      const keepHasDraft = keep.id ? (await db.draftReplies.where("emailId").equals(keep.id).count()) > 0 : false;
      if (extraDrafts.length > 0 && keep.id && !keepHasDraft) {
        await db.draftReplies.update(extraDrafts[0].id!, { emailId: keep.id });
        for (const leftover of extraDrafts.slice(1)) await db.draftReplies.delete(leftover.id!);
      } else {
        for (const draft of extraDrafts) await db.draftReplies.delete(draft.id!);
      }
      await db.syncedEmails.delete(extra.id);
      removed++;
    }
  }
  return removed;
}
