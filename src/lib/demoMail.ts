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

// 2026-11-27: 就活のメール(面接の案内・選考結果など)はやめ、くらしの一般的なメールにした。デモは応募先の企業にも見せるため。
const MAILS: DemoMail[] = [
  {
    id: "demo-mail-1",
    from: "みどり歯科クリニック <info@midori-dental.example>",
    subject: "ご予約の確認(今日 18:30)",
    hoursAgo: 2,
    important: true,
    body:
      "デモ ユーザー様\n\nいつもご来院ありがとうございます。下記のとおりご予約を承っております。\n\n" +
      "日時: 今日 18:30〜19:15\n内容: 定期検診\n\nご都合が悪くなった場合は、お電話でご連絡ください。\n\nみどり歯科クリニック",
    draft: {
      subject: "Re: ご予約の確認(今日 18:30)",
      body: "みどり歯科クリニック様\n\nご連絡ありがとうございます。\n本日 18:30 に伺います。どうぞよろしくお願いいたします。\n\nデモ ユーザー",
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
    from: "ネットストア配送センター <delivery@store.example>",
    subject: "お荷物のお届け予定(明日 19〜21時)",
    hoursAgo: 8,
    body: "デモ ユーザー様\n\nご注文の商品を発送しました。\nお届け予定: 明日 19:00〜21:00\n\n受け取りの日時は、配送会社のページから変えられます。",
  },
  {
    id: "demo-mail-4",
    from: "ヨガスタジオ Lumi <hello@lumi-yoga.example>",
    subject: "体験レッスンのご案内",
    hoursAgo: 20,
    body: "デモ ユーザー様\n\n先日はお問い合わせありがとうございました。\n平日の夜と週末の朝に、初めての方向けの体験レッスンがあります。ご都合のよい日をお知らせください。",
  },
  {
    id: "demo-mail-5",
    from: "四条ステイ 予約係 <reserve@shijo-stay.example>",
    subject: "ご予約の確認(3泊・四条のホテル)",
    hoursAgo: 26,
    read: true,
    body: "デモ ユーザー様\n\nご予約ありがとうございます。下記の内容で承りました。\n\nチェックイン: 16:00〜\n宿泊: 3泊\n\n当日のお越しをお待ちしております。",
  },
  {
    id: "demo-mail-6",
    from: "さくらカード <info@sakura-card.example>",
    subject: "ご利用金額のお知らせ(11月分)",
    hoursAgo: 40,
    body: "デモ ユーザー様\n\n今月のご利用金額が確定しました。お引き落としは来月の27日です。\n明細は会員ページでご確認いただけます。",
  },
  {
    id: "demo-mail-7",
    from: "町内会 事務局 <office@chonaikai.example>",
    subject: "年末の清掃のお知らせ",
    hoursAgo: 60,
    read: true,
    body: "町内会の皆さま\n\n年末の清掃を、来月の第2日曜 9:00〜 に行います。軍手をお持ちください。",
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
