import type { DraftReply, GmailAccount, SyncedEmail } from "../types";
import { parseSender } from "./gmail";
import { companyAliases } from "./jobMailSuggestion";

/**
 * 「返信待ち」— こちらから返信を送ったのに、相手からしばらく返事が来ていないやり取り
 * (依頼「返信待ちトラッカーが欲しい」)。
 *
 * AIもGmail APIも呼ばない。端末にある受信メール(syncedEmails)と、送った記録
 * (syncedEmails.status と draftReplies.sentAt)だけで決める。相手から返事が来れば、
 * それが次の同期で同じスレッドの新しい受信メールとして入ってくるので、自然に外れる。
 */

/** 返信を送ってから、この日数たっても返事が無ければ「返信待ち」に出す。
 * 1〜2日は普通に返事を待つ間なので、出すと一覧が「送ったばかり」で埋まる。 */
export const REPLY_WAIT_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReplyWaitingItem {
  /** こちらが最後に返信した、相手からのメール。一覧ではこの行を出す。 */
  email: SyncedEmail;
  /** 返信を送った時刻(分からない時はなるべく近いもの。sentAtOf を参照)。 */
  sentAt: number;
  /** 送ってから何日たったか(切り捨て)。 */
  waitingDays: number;
}

/**
 * 返信を送った時刻。
 *
 * - このアプリから送った・Gmail側で送ったのを同期で見つけた → draftReplies.sentAt
 * - ほかの端末で送った(送信済みの印だけが gmail_message_state で届いた) → 下書きの行が
 *   無いので、状態を最後に変えた時刻(stateUpdatedAt)。送った時にほかの端末が付けた時刻が入る
 * - どちらも無い → そのメールを受け取った時刻(送ったのはそれより後なので、待った日数は
 *   多めに出るが、1件も出ないよりはよい)
 */
export function sentAtOf(email: Pick<SyncedEmail, "stateUpdatedAt" | "receivedAt">, draftSentAt?: number): number {
  return draftSentAt ?? email.stateUpdatedAt ?? email.receivedAt;
}

/**
 * 返信待ちのやり取りを、待っている日数の長い順に返す。
 *
 * 判定は「スレッドの中で相手から来た一番新しいメールに、こちらが返信済みか」で見る —
 * 送った時刻と相手の返事の時刻を比べる形にしなかったのは、Gmail側で送った返信は次の同期で
 * 初めて見つかり、送った時刻がその分遅れて記録されるため(その間に届いた相手の返事を
 * 「送る前のメール」と取り違える)。一番新しい受信にまだ返信していなければ、ボールは
 * こちらにあるので返信待ちではない。
 *
 * `emails` にはブロック中の送信者を外したものを渡す(一覧に出ないメールを数えないため)。
 */
export function pickReplyWaiting(
  emails: SyncedEmail[],
  drafts: Pick<DraftReply, "emailId" | "sentAt">[],
  accounts: Pick<GmailAccount, "id" | "email">[],
  now: number,
  minDays: number = REPLY_WAIT_DAYS,
): ReplyWaitingItem[] {
  const selfByAccount = new Map(accounts.map((account) => [account.id, account.email.toLowerCase()]));
  const draftSentAt = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.sentAt) draftSentAt.set(draft.emailId, Math.max(draftSentAt.get(draft.emailId) ?? 0, draft.sentAt));
  }

  // スレッドごとに、相手から来た一番新しいメール。自分が自分に送ったもの(署名テストなど)は
  // 相手の返事として数えない。
  const latestIncoming = new Map<string, SyncedEmail>();
  for (const email of emails) {
    if (!email.id) continue;
    const self = selfByAccount.get(email.accountId);
    if (self && parseSender(email.from).email.toLowerCase() === self) continue;
    const key = `${email.accountId}:${email.threadId || email.id}`;
    const current = latestIncoming.get(key);
    if (!current || email.receivedAt > current.receivedAt) latestIncoming.set(key, email);
  }

  const items: ReplyWaitingItem[] = [];
  for (const email of latestIncoming.values()) {
    if (email.status !== "sent") continue;
    const sentAt = sentAtOf(email, draftSentAt.get(email.id!));
    const waitingDays = Math.floor((now - sentAt) / DAY_MS);
    if (waitingDays < minDays) continue;
    items.push({ email, sentAt, waitingDays });
  }
  return items.sort((a, b) => a.sentAt - b.sentAt);
}

function normalize(text: string): string {
  return text.replace(/\s|　/g, "").toLowerCase();
}

/**
 * 就活の応募先1社ぶんの返信待ち。差出人・件名・抜粋に会社名が出てくるものを探す
 * (選考メールの提案 src/lib/jobMailSuggestion.ts と同じ会社名の見比べ方)。
 * 複数あれば一番長く待っているもの。
 */
export function replyWaitingForCompany(companyName: string, items: ReplyWaitingItem[]): ReplyWaitingItem | undefined {
  const aliases = companyAliases(companyName);
  if (aliases.length === 0) return undefined;
  return items.find((item) => {
    const haystack = normalize(`${item.email.from} ${item.email.subject} ${item.email.snippet}`);
    return aliases.some((alias) => haystack.includes(alias));
  });
}
