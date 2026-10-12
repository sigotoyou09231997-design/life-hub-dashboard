import type { BlockedSender, GmailAccount, SyncedEmail } from "../types";
import { parseSender } from "./gmail";

/**
 * Gmail の画面を開いた最初の描画から並べるための控え(2026-10-13、本人「Gmailを押した時の切り替わりを
 * もっと短く」)。端末(IndexedDB)から読み出し終わるまでの間は、これを使う。読み出しが終われば本物に置き換わる。
 *
 * 画面を開いた時(GmailPage / GmailInbox)と、アプリを起動して手が空いた時(src/lib/gmailWarmup.ts)に書く。
 * 読み出しは iPhone では特に遅く、起動後の最初の1回だけ、押してから一覧が出るまでが長かった。
 */
export const gmailViewCache: {
  accounts: GmailAccount[] | undefined;
  list: { accountId: string; emails: SyncedEmail[]; blocked: BlockedSender[] | undefined } | null;
} = { accounts: undefined, list: null };

/** ブロックした送信者のメールを除いた一覧。描き直すたびに差出人を読み直さないよう、呼ぶ側で控えて使うこと。 */
export function visibleMailsFor(emails: SyncedEmail[], blocked: BlockedSender[] | undefined): SyncedEmail[] {
  const blockedSet = new Set((blocked ?? []).map((b) => b.email));
  return emails.filter((email) => !blockedSet.has(parseSender(email.from).email.toLowerCase()));
}
