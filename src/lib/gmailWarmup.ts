import { db } from "../db/schema";
import { startMailSuggestions } from "../hooks/useMailSuggestions";
import { readSelectedGmailAccountId, resolveSelectedGmailAccountId } from "./gmailAccounts";
import { gmailViewCache, visibleMailsFor } from "./gmailViewCache";

let warmed = false;

/**
 * アプリを起動して手が空いた時に、Gmail の一覧を端末から読んでおく(2026-10-13)。
 *
 * 押してから読み出すと、iPhone では最初の1回だけ一覧が出るまでが長かった(数百〜千通を端末の保存領域から
 * 読み出すのが遅い)。先に読んで控えておけば(src/lib/gmailViewCache.ts)、最初の1回目から、開き直した時と
 * 同じ速さで並ぶ。「予定候補」の判定も、ここで分けて済ませておく。
 *
 * 連携していない人は何もしない。1回の起動につき1回だけ。失敗しても画面には何も出さない(押した時に普通に読む)。
 */
export async function warmGmail(): Promise<void> {
  if (warmed) return;
  warmed = true;
  try {
    const accounts = await db.gmailAccounts.toArray();
    if (accounts.length === 0) return;
    gmailViewCache.accounts = accounts;
    const accountId = resolveSelectedGmailAccountId(accounts, readSelectedGmailAccountId());
    if (!accountId) return;
    const [emails, blocked] = await Promise.all([
      db.syncedEmails.where("accountId").equals(accountId).reverse().sortBy("receivedAt"),
      db.blockedSenders.where("accountId").equals(accountId).toArray(),
    ]);
    gmailViewCache.list = { accountId, emails, blocked };
    startMailSuggestions(accountId, visibleMailsFor(emails, blocked));
  } catch {
    warmed = false;
  }
}
