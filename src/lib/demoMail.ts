// デモ(/demo)の Gmail の見本(2026-11-27)。採用担当など、アカウントを持たない人に「受信メールと AI 返信案」を
// 見せるためのもの。中身はすべて架空(送り主・会社・アドレスは example ドメイン)。
//
// 【本物には触らない】デモでは Gmail の通信をしない(src/lib/gmail.ts の gmailFetch・ensureFreshAccessToken、
// src/lib/gmailSync.ts の syncGmailAccount、src/lib/mailContentCache.ts の loadMailContent がデモの時だけここを使う)。
// トークンは見本の文字で、どこにも送らない。
import type { DraftReply, GmailAccount, SyncedEmail } from "../types";

export const DEMO_GMAIL_ACCOUNT_ID = "demo-gmail";
export const DEMO_GMAIL_ADDRESS = "demo.user@example.com";

/** デモで Gmail の通信をしようとした時の断り(送信など)。 */
export const DEMO_MAIL_MESSAGE = "デモではメールの送受信はしません（実際のアプリでは Gmail とつながります）。";

interface DemoMail {
  id: string;
  from: string;
  subject: string;
  /** 何時間前に届いたか。 */
  hoursAgo: number;
  body: string;
  read?: boolean;
  important?: boolean;
  /** AI 返信案(下書き)。あるメールだけ「返信案あり」で出る。 */
  draft?: { subject: string; body: string };
}

const MAILS: DemoMail[] = [
  {
    id: "demo-mail-1",
    from: "株式会社アオイ 採用担当 <saiyo@aoi.example>",
    subject: "一次面接の日程のご案内",
    hoursAgo: 2,
    important: true,
    body:
      "デモ ユーザー様\n\nこのたびは弊社の Webエンジニア職にご応募いただき、ありがとうございます。\n" +
      "一次面接を、オンライン(Zoom)で行いたく存じます。\n\n" +
      "候補日: 明後日 14:00〜15:00\n所要時間: 約60分\n\nご都合をお知らせいただけますと幸いです。\n\n株式会社アオイ 採用担当",
    draft: {
      subject: "Re: 一次面接の日程のご案内",
      body:
        "株式会社アオイ 採用担当様\n\nご連絡ありがとうございます。デモでございます。\n" +
        "ご提示いただいた日程(明後日 14:00〜15:00)で、ぜひお願いいたします。\n" +
        "当日はどうぞよろしくお願いいたします。\n\nデモ ユーザー",
    },
  },
  {
    id: "demo-mail-2",
    from: "佐藤 さくら <sakura.sato@example.com>",
    subject: "明日の夕食、新宿で大丈夫?",
    hoursAgo: 5,
    body: "おつかれさま!\n明日の夕食、19時に新宿で大丈夫かな?\nお店はこの前話していたイタリアンにしようと思ってます。",
    draft: {
      subject: "Re: 明日の夕食、新宿で大丈夫?",
      body: "おつかれさま!\n19時に新宿で大丈夫です。イタリアン楽しみにしてるね。\nまた明日!",
    },
  },
  {
    id: "demo-mail-3",
    from: "四条ステイ 予約係 <reserve@shijo-stay.example>",
    subject: "ご予約の確認(3泊・四条のホテル)",
    hoursAgo: 26,
    read: true,
    body: "デモ ユーザー様\n\nご予約ありがとうございます。下記の内容で承りました。\n\nチェックイン: 16:00〜\n宿泊: 3泊\n\n当日のお越しをお待ちしております。",
  },
  {
    id: "demo-mail-4",
    from: "そらデザイン <hello@sora.example>",
    subject: "ポートフォリオを拝見しました",
    hoursAgo: 30,
    body: "デモ ユーザー様\n\nポートフォリオを拝見しました。生活まわりのアプリの作り込みが印象的でした。\n一度カジュアルにお話しできればと思います。",
  },
  {
    id: "demo-mail-5",
    from: "ミドリ工業 人事部 <jinji@midori.example>",
    subject: "書類選考の結果について",
    hoursAgo: 50,
    read: true,
    body: "デモ ユーザー様\n\n書類選考の結果、次の選考へお進みいただくことになりました。\n詳細は追ってご連絡いたします。",
  },
];

export function demoGmailAccount(now: number): GmailAccount {
  return {
    id: DEMO_GMAIL_ACCOUNT_ID,
    email: DEMO_GMAIL_ADDRESS,
    // 見本の文字。デモでは通信しないので、どこにも使われない。
    accessToken: "demo",
    accessTokenExpiresAt: now + 365 * 24 * 60 * 60 * 1000,
    refreshToken: "demo",
    connectedAt: now - 30 * 24 * 60 * 60 * 1000,
    lastSyncedAt: now,
  };
}

export function demoSyncedEmails(now: number): SyncedEmail[] {
  return MAILS.map((mail) => {
    const receivedAt = now - mail.hoursAgo * 60 * 60 * 1000;
    return {
      id: mail.id,
      accountId: DEMO_GMAIL_ACCOUNT_ID,
      gmailMessageId: mail.id,
      threadId: mail.id,
      from: mail.from,
      subject: mail.subject,
      snippet: mail.body.replace(/\s+/g, " ").slice(0, 120),
      receivedAt,
      status: mail.draft ? "drafted" : "unprocessed",
      createdAt: receivedAt,
      ...(mail.read ? { readAt: receivedAt + 60 * 60 * 1000 } : {}),
      ...(mail.important ? { importantAt: receivedAt } : {}),
    } satisfies SyncedEmail;
  });
}

export function demoDraftReplies(now: number): DraftReply[] {
  return MAILS.filter((mail) => mail.draft).map((mail) => ({
    id: `${mail.id}-draft`,
    emailId: mail.id,
    accountId: DEMO_GMAIL_ACCOUNT_ID,
    to: mail.from.match(/<([^>]+)>/)?.[1],
    subject: mail.draft!.subject,
    body: mail.draft!.body,
    createdAt: now,
  }));
}

/** メールを開いた時の本文(src/lib/mailContentCache.ts の loadMailContent と同じ形)。 */
export function demoMailContent(gmailMessageId: string): { text: string; html: string; preferHtml: boolean; inlineImages: Record<string, string> } {
  const mail = MAILS.find((item) => item.id === gmailMessageId);
  return { text: mail?.body ?? "", html: "", preferHtml: false, inlineImages: {} };
}
