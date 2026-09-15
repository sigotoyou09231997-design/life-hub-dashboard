import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema";
import { parseSender } from "../lib/gmail";
import { pickReplyWaiting, type ReplyWaitingItem } from "../lib/replyWaiting";

/**
 * 端末にある全Gmailアカウントぶんの返信待ち(src/lib/replyWaiting.ts)。
 * Gmail画面・ホーム・就活タブから同じものを見る。読み込み中は undefined。
 *
 * ブロック中の送信者は外す — 受信トレイにもホームにも出ない相手を「返信待ち」として
 * 数えると、どこを開いても見当たらない件数になるため。
 */
export function useReplyWaiting(): ReplyWaitingItem[] | undefined {
  return useLiveQuery(async () => {
    const [accounts, blocked, emails, drafts] = await Promise.all([
      db.gmailAccounts.toArray(),
      db.blockedSenders.toArray(),
      db.syncedEmails.toArray(),
      db.draftReplies.toArray(),
    ]);
    if (accounts.length === 0) return [];
    const blockedSet = new Set(blocked.map((item) => `${item.accountId}:${item.email}`));
    const visible = emails.filter(
      (email) => !blockedSet.has(`${email.accountId}:${parseSender(email.from).email.toLowerCase()}`),
    );
    return pickReplyWaiting(visible, drafts, accounts, Date.now());
  }, []);
}
