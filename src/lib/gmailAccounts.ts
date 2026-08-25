import { db } from "../db/schema";
import { scopedKey } from "./accounts";
import { dedupeSyncedEmails } from "./syncedEmails";

/** 同じGmailアドレスで連携し直した時に増えてしまった重複アカウント行を1つにまとめ、
 * どのアカウントにも属さなくなった行(メール・AI下書き・ブロックリスト)を片付ける。
 *
 * 連携し直しは `db.gmailAccounts.add()` で新しいローカルUUIDの行を作っていたため、
 * 古い行がトークンごと残り続けていた。メール一覧は選択中のアカウントだけを見るので
 * 気付きにくい一方、TOPの未処理件数や通知は全アカウントぶんを合算するため、
 * 端末ごとに数字が食い違う原因になっていた(2026-08-24 修正)。
 *
 * 連携し直し側(GmailCallbackPage)は既存行を上書きするようにしたので、これは既に
 * 重複してしまっている端末を直すための後片付け。安全に何度でも呼べる。 */
export async function consolidateGmailAccounts(): Promise<number> {
  const accounts = await db.gmailAccounts.toArray();

  const byEmail = new Map<string, typeof accounts>();
  for (const account of accounts) {
    if (!account.id) continue;
    const key = account.email.toLowerCase();
    const group = byEmail.get(key) ?? [];
    group.push(account);
    byEmail.set(key, group);
  }

  let merged = 0;
  for (const group of byEmail.values()) {
    if (group.length < 2) continue;
    // いちばん最後に連携した行を残す — トークンが生きているのはそれだけ。
    const [keeper, ...extras] = [...group].sort((a, b) => b.connectedAt - a.connectedAt);
    for (const extra of extras) {
      await db.syncedEmails.where("accountId").equals(extra.id!).modify({ accountId: keeper.id! });
      await db.draftReplies.where("accountId").equals(extra.id!).modify({ accountId: keeper.id! });
      await db.blockedSenders.where("accountId").equals(extra.id!).modify({ accountId: keeper.id! });
      await db.gmailAccounts.delete(extra.id!);
      merged++;
    }
    // 付け替えた結果、同じメールが2行(重複していたアカウントぶん)になっていることが
    // ある — どちらのアカウントも同じ受信トレイを取り込んでいたため。ここで畳まないと、
    // まったく同じ差出人・件名・時刻の行が一覧に二重で並ぶ(2026-08-24 に発生)。
    await dedupeSyncedEmails(keeper.id!);
    await dedupeBlockedSenders(keeper.id!);
  }

  await deleteOrphans();
  return merged;
}

/** 付け替えで同じ送信者が複数行になることがあるため、アドレスごとに1行に落とす。 */
async function dedupeBlockedSenders(accountId: string): Promise<void> {
  const rows = await db.blockedSenders.where("accountId").equals(accountId).toArray();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id) continue;
    if (seen.has(row.email)) await db.blockedSenders.delete(row.id);
    else seen.add(row.email);
  }
}

/** 連携を解除した/重複を消した結果、存在しないアカウントにぶら下がったままの行を消す。
 * 残しても表示はされないが、TOPや通知の件数には数えられてしまう。 */
async function deleteOrphans(): Promise<void> {
  const liveIds = new Set((await db.gmailAccounts.toArray()).map((account) => account.id));

  const orphanEmails = (await db.syncedEmails.toArray()).filter((email) => !liveIds.has(email.accountId));
  for (const email of orphanEmails) {
    if (email.id) await db.syncedEmails.delete(email.id);
  }

  const orphanDrafts = (await db.draftReplies.toArray()).filter((draft) => !liveIds.has(draft.accountId));
  for (const draft of orphanDrafts) {
    if (draft.id) await db.draftReplies.delete(draft.id);
  }

  const orphanBlocks = (await db.blockedSenders.toArray()).filter((blocked) => !liveIds.has(blocked.accountId));
  for (const blocked of orphanBlocks) {
    if (blocked.id) await db.blockedSenders.delete(blocked.id);
  }
}

/** Gmail画面で最後に選んでいたアカウント。以前は画面を開き直すたびに1件目へ戻っていて、
 * 2件目をよく見る場合は毎回タブを押し直す必要があった(2026-08-25 修正)。
 *
 * Dexieではなくlocalstorageに置くのは、これが「この端末での見え方」であって同期する
 * データではないため — PCとスマホで別々のアカウントを開いたままにしておいてよい。
 * キーを scopedKey に通すのは、端末内のアカウント(src/lib/accounts.ts)を切り替えた時に
 * 互いの選択を上書きしないようにするため。 */
const SELECTED_ACCOUNT_KEY = scopedKey("lifeHubGmailSelectedAccount");

export function readSelectedGmailAccountId(): string | null {
  try {
    return localStorage.getItem(SELECTED_ACCOUNT_KEY);
  } catch {
    // プライベートモード等で読めなくても、1件目が選ばれるだけで表示は続けられる。
    return null;
  }
}

export function rememberSelectedGmailAccountId(accountId: string): void {
  try {
    localStorage.setItem(SELECTED_ACCOUNT_KEY, accountId);
  } catch {
    // 同上。覚えられないだけで、その場の選択自体は効いている。
  }
}

/** 覚えていた選択を、今ある連携アカウントと突き合わせて実際に表示する1件を決める。
 *
 * 連携を解除した後などは、覚えているIDがもう存在しない行を指している。その場合は
 * 黙って1件目に戻す — null のままにすると、アカウントはあるのに一覧が出ない。 */
export function resolveSelectedGmailAccountId(
  accounts: { id?: string }[],
  remembered: string | null,
): string | null {
  if (accounts.length === 0) return null;
  if (remembered != null && accounts.some((account) => account.id === remembered)) return remembered;
  return accounts[0].id ?? null;
}
