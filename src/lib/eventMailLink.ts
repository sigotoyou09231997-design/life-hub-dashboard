import { db } from "../db/schema";
import type { EventMailLink, GmailAccount, SyncedEmail } from "../types";

/**
 * メールから作った予定に、元のメールへのつながりを残す(依頼「予定に元メールへのリンクを残したい」)。
 *
 * つながりは予定の行ではなく eventMailLinks テーブルに置く(types/index.ts の EventMailLink)。
 */

/** 予定1件ぶんのつながり。メールは端末ごとのidではなくGmail側のidとアドレスで持つ。 */
export function toEventMailLinkRecord(
  eventId: string,
  account: Pick<GmailAccount, "email">,
  email: Pick<SyncedEmail, "gmailMessageId" | "threadId" | "subject" | "from">,
  now: number,
): EventMailLink {
  return {
    eventId,
    accountEmail: account.email,
    gmailMessageId: email.gmailMessageId,
    threadId: email.threadId || undefined,
    subject: email.subject || undefined,
    sender: email.from || undefined,
    createdAt: now,
  };
}

/** Gmail本体でそのメールを開くURL。/u/<アドレス>/ でアカウントを選ぶので、
 * 複数のGoogleアカウントでログインしているブラウザでも、受け取った方で開く。 */
export function gmailWebUrl(link: Pick<EventMailLink, "accountEmail" | "gmailMessageId">): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(link.accountEmail)}/#all/${encodeURIComponent(link.gmailMessageId)}`;
}

export type MailLinkTarget = { kind: "app"; to: string } | { kind: "gmail"; href: string };

/**
 * 「元のメールを開く」の行き先。この端末にそのメールがあればアプリのメール画面、
 * 無ければGmail本体。
 *
 * 端末に無いのは、ほかの端末で作った予定(025 を流して同期した後)と、受信トレイから
 * 外れて端末から消えたメール(src/lib/gmailSync.ts の pruneMissingEmails)。
 * どちらもGmailには残っているので、行き止まりにはしない。
 */
export async function resolveMailLinkTarget(
  link: Pick<EventMailLink, "accountEmail" | "gmailMessageId">,
): Promise<MailLinkTarget> {
  const account = await db.gmailAccounts.where("email").equals(link.accountEmail).first();
  if (account?.id) {
    const email = await db.syncedEmails
      .where("[accountId+gmailMessageId]")
      .equals([account.id, link.gmailMessageId])
      .first();
    if (email?.id) return { kind: "app", to: `/gmail/mail/${email.id}` };
  }
  return { kind: "gmail", href: gmailWebUrl(link) };
}

/** 予定に付いているつながり。複数あれば最初に作ったもの(1件の予定は1通のメールから作る)。 */
export async function findEventMailLink(eventId: string): Promise<EventMailLink | null> {
  const links = await db.eventMailLinks.where("eventId").equals(eventId).toArray();
  return links.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

/** 予定を消した時に、指す先の無くなったつながりも消す。 */
export async function deleteEventMailLinks(eventId: string): Promise<void> {
  await db.eventMailLinks.where("eventId").equals(eventId).delete();
}
