import { db } from "../db/schema";
import type { GmailAccount, SyncedEmail } from "../types";
import { isUnhandledEmail, parseSender } from "./gmail";
import { updateMessageState } from "./gmailMessageState";
import { normalizeText } from "./mailPlanSuggestion";

/**
 * 「未処理」に、返事のいらないメールを残さない(2026-11-24、本人「LIFE HUBの未処理一覧も振り分けも自動でして欲しい」
 * 「ここで対応したやつや、勧誘、返信がいらないものなどを振り分ける感じ」)。
 *
 * 求人サイトの「おすすめ求人」「新着求人」、自動で届くオファーの知らせ、ポイント・セールの広告などは、
 * 毎日何十通も届いて未処理を埋め、肝心の企業からの連絡が埋もれていた。こうしたメールを、同期のたびに
 * 確認なしで既読にする(既読タブへ移るだけで、消しはしない)。
 *
 * **間違って片付けない**ことを優先する:
 *  - 面接・選考・書類・日程・内定・応募先の企業からのメッセージのような、本人が動く必要のある言葉が
 *    件名か抜粋にあれば、ほかの条件に当たっても触らない(配信元のアドレスが一斉配信用でも同じ)。
 *  - 片付けるのは、一斉配信の差出人か、件名が明らかに案内・宣伝のものだけ。迷うものは未処理に残す。
 *  - 一度片付けたメールには autoTriagedAt を付け、本人が未読に戻したら二度と片付けない。
 * AI は使わない。本人の端末の中の文字合わせだけ。
 *
 * 「ここで対応したもの」= Gmail から返信したメールは、すでに同期で「送信済み」になり未処理から外れる
 * (src/lib/gmailSync.ts の threadHasSentReplyAfter)。ここではそれ以外を扱う。
 */

/** 本人が動く必要がある連絡の言葉。どれかがあれば片付けない。 */
const ACTION_WORDS = [
  "面接",
  "面談",
  "選考",
  "書類",
  "日程",
  "内定",
  "合否",
  "ご提出",
  "提出",
  "ご回答",
  "ご返信",
  "ご確認ください",
  "締切",
  "期限",
  "応募先の企業から",
  "企業からメッセージ",
  "より新しいメッセージ",
  "からメッセージが届きました",
  "ご挨拶",
  "認証コード",
  "確認コード",
  "ログイン",
  "パスワード",
  "請求",
  "支払",
  "ご注文",
  "発送",
  "予約",
];

/** 一斉配信の差出人(アドレスの @ より前)。求人サイトの案内・メルマガで使われる名前。 */
const BULK_SENDER_LOCALS = [
  /^newjobs$/,
  /^matchjobs$/,
  /^mailnews$/,
  /^agent-mailnews$/,
  /^recommendation$/,
  /^info-marketing$/,
  /^type_editor$/,
  /^info_u$/,
  /^rekatsu-mail$/,
  /^jobs$/,
  /^shein$/,
  /^rakuten-.*news$/,
  /news(letter)?$/,
  /magazine$/,
  /^mag(azine)?[-_.]/,
  /^campaign/,
  /^promo/,
];

/** 一斉配信だけを送るドメイン(@ より後ろの末尾)。 */
const BULK_SENDER_DOMAINS = [
  "jobalert.indeed.com",
  "tmn.mynavi.jp",
  "mid-tenshoku.com",
  "emagazine.rakuten.co.jp",
  "email.shein.com",
  "sevenmp.omni7.jp",
  "mail.linemo.jp",
];

/** 件名が案内・宣伝だと分かる言葉。 */
const NOTICE_SUBJECT_WORDS = [
  "おすすめ求人",
  "オススメ求人",
  "新着求人",
  "求人特集",
  "求人をセレクト",
  "求人をピックアップ",
  "求人をご紹介",
  "求人紹介です",
  "求人情報をお届け",
  "求人案内",
  "求人一覧",
  "最近チェックした求人",
  "注目されている",
  "人気求人",
  "新着情報",
  "オファーが届いています",
  "から再度オファー",
  "いいねが届きました",
  "未読リマインド",
  "アンケート",
  "コラム",
  "特集がまもなく",
  "まもなく終了",
  "セール",
  "キャンペーン",
  "クーポン",
  "ポイント",
  "マイル",
  "くじ",
  "メルマガ",
  "プレゼント",
];

export interface AutoTriageVerdict {
  /** 片付ける理由(テストと、あとで振り返る時のため)。 */
  reason: "bulk-sender" | "notice-subject";
}

/** このメールを未処理から片付けてよいか。片付けないなら null。 */
export function classifyAutoTriage(email: Pick<SyncedEmail, "from" | "subject" | "snippet">): AutoTriageVerdict | null {
  const subject = normalizeText(email.subject ?? "");
  const text = `${subject} ${normalizeText(email.snippet ?? "")}`;
  if (ACTION_WORDS.some((word) => text.includes(word))) return null;

  const address = parseSender(email.from).email.toLowerCase();
  const [local = "", domain = ""] = address.split("@");
  if (BULK_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { reason: "bulk-sender" };
  if (BULK_SENDER_LOCALS.some((pattern) => pattern.test(local))) return { reason: "bulk-sender" };
  if (NOTICE_SUBJECT_WORDS.some((word) => subject.includes(word))) return { reason: "notice-subject" };
  return null;
}

/** 古いメールを後から掘り起こして片付けない(未処理に出るのも30日以内のため)。 */
const AUTO_TRIAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 同期の最後に呼ぶ。未処理のうち、返事のいらないメールを既読にして、何件片付けたかを返す。
 *
 * - 既読は他の端末にも配る(updateMessageState。本人が既読を押した時と同じ道)。
 * - 片付けたメールには autoTriagedAt を付け、本人が未読に戻しても二度は片付けない。
 * - 設定の「返事のいらないメールを自動で既読にする」が切ってあれば何もしない(未設定はON)。
 */
export async function autoTriageEmails(
  account: Pick<GmailAccount, "email">,
  accountId: string,
  now: number = Date.now(),
): Promise<number> {
  const settings = await db.settings.toCollection().first();
  if (settings?.autoTriageEnabled === false) return 0;

  const candidates = (await db.syncedEmails.where("accountId").equals(accountId).toArray()).filter(
    (email) => email.id && !email.autoTriagedAt && isUnhandledEmail(email) && email.receivedAt >= now - AUTO_TRIAGE_WINDOW_MS,
  );
  let count = 0;
  for (const email of candidates) {
    if (!classifyAutoTriage(email)) continue;
    await db.syncedEmails.update(email.id!, { autoTriagedAt: now });
    await updateMessageState(account.email, email, { readAt: now });
    count++;
  }
  return count;
}
