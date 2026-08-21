import { db } from "../db/schema";
import type { EmailStatus, GmailAccount, SyncedEmail } from "../types";
import { toDateStr, todayStr } from "./date";

const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Refresh proactively so a call never starts on a token that expires mid-request. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
/** How far ahead the AI draft looks at the calendar to propose real open dates. */
const SCHEDULE_LOOKAHEAD_DAYS = 21;
const STYLE_EXAMPLE_COUNT = 5;
/** sessionStorage key shared between the OAuth-initiating page and the callback page for CSRF-state verification. */
export const GMAIL_OAUTH_STATE_KEY = "gmailOAuthState";

export function startGmailOAuth(): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(GMAIL_OAUTH_STATE_KEY, state);
  window.location.href = buildAuthUrl(state);
}

export function getRedirectUri(): string {
  return `${window.location.origin}/gmail/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** RFC 2047 encoded-word, needed because raw email headers must stay ASCII (e.g. Japanese subjects). */
export function encodeHeaderWord(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/** Thrown by callFunction() on a non-2xx response. Carries the HTTP status and,
 * when the server responded with our own `{ error: "..." }` JSON shape (as every
 * api/*.ts function does), that exact message — so callers can show the server's
 * actual, specific reason instead of one generic string for every failure mode. */
export class ApiFunctionError extends Error {
  status: number;
  serverMessage?: string;
  constructor(name: string, status: number, rawText: string) {
    let serverMessage: string | undefined;
    try {
      const parsed = JSON.parse(rawText) as { error?: string };
      serverMessage = parsed.error;
    } catch {
      // Not our JSON error shape (e.g. a platform-level timeout/error page) — leave undefined.
    }
    super(serverMessage ?? `${name} failed (${status})`);
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiFunctionError(name, res.status, text);
  }
  return res.json() as Promise<T>;
}

export interface AuthorizationCodeResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  email: string;
}

export async function exchangeAuthorizationCode(code: string): Promise<AuthorizationCodeResult> {
  return callFunction<AuthorizationCodeResult>("tokenExchange", {
    grantType: "authorization_code",
    code,
    redirectUri: getRedirectUri(),
  });
}

/** Returns an account guaranteed to have a live access token, refreshing (and persisting) it first if needed. */
export async function ensureFreshAccessToken(account: GmailAccount): Promise<GmailAccount> {
  if (account.accessTokenExpiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return account;
  }
  const result = await callFunction<{ accessToken: string; expiresIn: number }>("tokenExchange", {
    grantType: "refresh_token",
    refreshToken: account.refreshToken,
  });
  const updated: GmailAccount = {
    ...account,
    accessToken: result.accessToken,
    accessTokenExpiresAt: Date.now() + result.expiresIn * 1000,
  };
  if (account.id) {
    await db.gmailAccounts.update(account.id, {
      accessToken: updated.accessToken,
      accessTokenExpiresAt: updated.accessTokenExpiresAt,
    });
  }
  return updated;
}

export interface BusySlot {
  date: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
}

export interface GenerateDraftInput {
  /** Reply mode: from/subject/body (of the received email) present together. Compose mode
   * (see generateComposeDraft) omits all three and supplies `to` instead. */
  from?: string;
  subject?: string;
  body?: string;
  to?: string;
  busySlots?: BusySlot[];
  userNotes?: string;
  currentDraft?: string;
  styleExamples?: string[];
}

export interface CandidateDate {
  date: string;
  startTime?: string;
  endTime?: string;
  label: string;
}

export interface GenerateDraftResult {
  draft: string;
  keyPoints: string[];
  candidateDates: CandidateDate[];
  /** Earliest date the AI found explicitly stated in the original email (e.g. "8月17日以降で"),
   * as YYYY-MM-DD — empty string when the email states no such constraint. */
  earliestDate: string;
  subject: string;
}

export async function generateDraft(input: GenerateDraftInput): Promise<GenerateDraftResult> {
  return callFunction<GenerateDraftResult>("generateDraft", input);
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** Mirrors api/generateDraft.ts's formatCandidateLabel exactly (also duplicated,
 * unused now, in netlify/functions/generateDraft.ts) — used
 * when the user edits a candidate date, so the newly-computed label matches the
 * format the AI was instructed to use in the draft body (needed for the
 * find-and-replace in DraftReview.tsx to locate the right text). */
export function formatCandidateLabel(slot: { date: string; startTime?: string; endTime?: string }): string {
  const d = new Date(`${slot.date}T00:00:00`);
  const md = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]})`;
  if (slot.startTime && slot.endTime) return `${md} ${slot.startTime}〜${slot.endTime}`;
  if (slot.startTime) return `${md} ${slot.startTime}〜`;
  return md;
}

/** Upcoming calendar events (date/time only — no titles/locations, to keep what's
 * sent to the AI minimal) so a scheduling reply can propose genuinely open dates
 * instead of inventing them. */
async function getUpcomingBusySlots(): Promise<BusySlot[]> {
  const start = todayStr();
  const end = toDateStr(new Date(Date.now() + SCHEDULE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000));
  const events = await db.calendarEvents.where("date").between(start, end, true, true).sortBy("date");
  return events.map((e) => ({ date: e.date, startTime: e.startTime, endTime: e.endTime, allDay: e.allDay }));
}

/** Fetches the email body, asks the AI to draft a reply, and upserts it into
 * draftReplies (one row per email, updated in place on regenerate). Shared by
 * the inbox's per-row/bulk "AI下書きを作成" and the review sheet's "再生成".
 *
 * currentDraftBody: the reply text currently shown on screen (pass DraftReview.tsx's
 * live bodyText state, unsaved edits included — not the possibly-stale saved draft).
 * Each call here is otherwise stateless: the model never sees its own prior output,
 * so a userNotes instruction like "この日付消して" that assumes shared context (the
 * way it would in an ordinary Claude/ChatGPT chat) has nothing for "この" to resolve
 * against without this. Omit on first-time generation, when there's no draft yet. */
export async function generateDraftForEmail(
  account: GmailAccount,
  email: SyncedEmail,
  userNotes?: string,
  currentDraftBody?: string,
): Promise<GenerateDraftResult> {
  if (!email.id || !account.id) throw new Error("email/account is missing an id");
  const emailId = email.id;
  const fallbackStatus: EmailStatus =
    email.status === "drafted" || email.status === "edited" || email.status === "sent" ? email.status : "unprocessed";

  await db.syncedEmails.update(emailId, { status: "generating" });
  try {
    const fresh = await ensureFreshAccessToken(account);
    const body = await getMessageBody(fresh.accessToken, email.gmailMessageId);
    const busySlots = await getUpcomingBusySlots();
    const styleExamples = await getRecentSentBodies(fresh.accessToken, STYLE_EXAMPLE_COUNT);
    const result = await generateDraft({
      from: email.from,
      subject: email.subject,
      body: body || email.snippet,
      busySlots,
      userNotes,
      currentDraft: currentDraftBody,
      styleExamples,
    });
    const now = Date.now();
    const existing = await db.draftReplies.where("emailId").equals(emailId).first();
    if (existing?.id) {
      await db.draftReplies.update(existing.id, { body: result.draft, subject: result.subject, userNotes, updatedAt: now });
    } else {
      await db.draftReplies.add({
        emailId,
        accountId: account.id,
        body: result.draft,
        subject: result.subject,
        userNotes,
        createdAt: now,
        updatedAt: now,
      });
    }
    await db.syncedEmails.update(emailId, { status: "drafted" });
    return result;
  } catch (err) {
    await db.syncedEmails.update(emailId, { status: fallbackStatus });
    throw err;
  }
}

/** Compose-mode counterpart to generateDraftForEmail() — there's no existing SyncedEmail/
 * thread to attach a draft to (compose is for a brand-new message), so this just calls the
 * AI and returns the result directly; ComposeMail.tsx keeps it in local component state
 * instead of persisting to draftReplies. currentDraftBody works the same way as
 * generateDraftForEmail's: pass the live on-screen body when regenerating (not on
 * first-time generation), so a referential instruction like "この日付消して" has something
 * to resolve against. */
export async function generateComposeDraft(
  account: GmailAccount,
  input: { to: string; userNotes: string; currentDraftBody?: string },
): Promise<GenerateDraftResult> {
  const fresh = await ensureFreshAccessToken(account);
  const busySlots = await getUpcomingBusySlots();
  const styleExamples = await getRecentSentBodies(fresh.accessToken, STYLE_EXAMPLE_COUNT);
  return generateDraft({
    to: input.to,
    userNotes: input.userNotes,
    busySlots,
    currentDraft: input.currentDraftBody,
    styleExamples,
  });
}

async function gmailFetch(accessToken: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API error (${res.status}): ${text}`);
  }
  return res.json();
}

export async function listRecentMessageIds(accessToken: string, sinceEpochSec: number): Promise<string[]> {
  // in:inbox を付けないと、Gmail検索のデフォルト範囲(受信トレイ+送信済み)により、この
  // アプリ自身が送信した返信(送信済みフォルダ行き)まで受信一覧に混ざってしまう。
  const params = new URLSearchParams({ q: `in:inbox after:${sinceEpochSec}`, maxResults: "100" });
  const data = await gmailFetch(accessToken, `/messages?${params.toString()}`);
  return ((data.messages ?? []) as { id: string }[]).map((m) => m.id);
}

async function listRecentSentMessageIds(accessToken: string, limit: number): Promise<string[]> {
  const params = new URLSearchParams({ q: "in:sent", maxResults: String(limit) });
  const data = await gmailFetch(accessToken, `/messages?${params.toString()}`);
  return ((data.messages ?? []) as { id: string }[]).map((m) => m.id);
}

/** Cuts off Gmail's own quoted-reply header and everything after it, so a sent message's
 * own newly-typed text isn't diluted by the quoted thread underneath (Gmail appends this in
 * both English "On ... wrote:" and Japanese "...のメッセージ:" forms, depending on locale).
 * Falls back to stripping "> "-quoted lines when no header match is found, since forwarded
 * or manually-quoted messages sometimes quote without one. */
function stripQuotedReply(body: string): string {
  const headerMatch = body.match(/^\s*(On .{0,120} wrote:|.{0,80}のメッセージ:)\s*$/m);
  const cut = headerMatch ? body.slice(0, headerMatch.index) : body;
  return cut
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
}

/** Bodies of the user's most recently sent Gmail messages (most-recent-first, quoted
 * thread text stripped), fed to the AI as few-shot style examples (see
 * api/generateDraft.ts's styleExamples) so generated drafts pick up the user's own
 * tone/wording automatically — no manual style configuration, and not limited to
 * replies sent through this app, since anything sent elsewhere (webmail, other
 * clients) lands in the same Gmail Sent folder. */
async function getRecentSentBodies(accessToken: string, limit: number): Promise<string[]> {
  const ids = await listRecentSentMessageIds(accessToken, limit);
  const bodies = await Promise.all(ids.map((id) => getMessageBody(accessToken, id).catch(() => "")));
  return bodies.map(stripQuotedReply).filter((b) => b.length > 0);
}

export interface ParsedSender {
  name: string;
  email: string;
}

/** Splits a `From` header (`"Taro Yamada" <taro@example.com>` or a bare address) into a display name + email. */
export function parseSender(from: string): ParsedSender {
  const match = from.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    return { name: name || email, email };
  }
  return { name: from.trim(), email: from.trim() };
}

/* 彩度の高い12色(bg-fuchsia-500など)から、落ち着いた濃色に入れ替えた。
   アバターは常にヘッダーの左上に出続ける = 画面で一番目立つ色になるため、
   蛍光色が1つ混じるだけで全体の印象が安っぽくなる。どれも白文字がAAで
   読める明度に揃えてある。 */
const AVATAR_COLORS = [
  "bg-[#26364f]",
  "bg-[#3f5470]",
  "bg-[#2d6560]",
  "bg-[#4a6141]",
  "bg-[#6f5c34]",
  "bg-[#8f5a42]",
  "bg-[#7d3f4e]",
  "bg-[#5c4566]",
  "bg-[#414a86]",
  "bg-[#4a5b66]",
  "bg-[#6a4b3a]",
  "bg-[#33566b]",
];

/** Deterministic avatar background so the same sender always gets the same color. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function findHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export interface GmailMessageMeta {
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: number;
}

export async function getMessageMeta(accessToken: string, id: string): Promise<GmailMessageMeta> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Subject");
  const data = await gmailFetch(accessToken, `/messages/${id}?${params.toString()}`);
  const headers = data.payload?.headers ?? [];
  return {
    threadId: data.threadId,
    from: findHeader(headers, "From"),
    subject: findHeader(headers, "Subject"),
    snippet: data.snippet ?? "",
    receivedAt: Number(data.internalDate ?? Date.now()),
  };
}

function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return base64UrlDecode(payload.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

export async function getMessageBody(accessToken: string, id: string): Promise<string> {
  const data = await gmailFetch(accessToken, `/messages/${id}?format=full`);
  return extractPlainText(data.payload).trim();
}

export interface MailAttachment {
  filename: string;
  mimeType: string;
  /** Standard (not base64url) base64 of the raw file bytes — this is the encoding a MIME
   * part's own Content-Transfer-Encoding: base64 body uses, independent of the base64url
   * encoding applied to the *entire* raw message afterward for Gmail's `raw` field. */
  base64Data: string;
}

/** Gmail rejects a send once the raw (base64-inflated) message gets too large; kept well
 * under Gmail's actual ~25MB cap (base64 inflates by ~37%, plus headers/boundaries) so this
 * app can reject an oversized attachment set client-side with a clear message instead of
 * making the user wait for a network round trip that Gmail was always going to refuse. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

export function attachmentsTotalBytes(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

/** Reads a File into a MailAttachment (base64-encoded), for buildRawMessage(). */
export function fileToAttachment(file: File): Promise<MailAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:<mime>;base64,<data>"
      const base64Data = result.slice(result.indexOf(",") + 1);
      resolve({ filename: file.name, mimeType: file.type || "application/octet-stream", base64Data });
    };
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Wraps base64 text at 76 chars/line per RFC 2045 — some mail servers/clients are strict about this. */
function wrapBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Builds the raw RFC 2822 message text (not yet base64url-encoded) for Gmail's messages.send
 * `raw` field: a plain text/plain body when there are no attachments, or multipart/mixed (one
 * text part + one part per attachment) otherwise. Shared by sendReply() and sendNewMail() so
 * both get attachment support from the same place. */
export function buildRawMessage(headers: { to: string; subject: string }, body: string, attachments: MailAttachment[]): string {
  const headerLines = [`To: ${headers.to}`, `Subject: ${encodeHeaderWord(headers.subject)}`];
  if (attachments.length === 0) {
    return [...headerLines, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", body].join("\r\n");
  }
  const boundary = `----=_LifeHub_${crypto.randomUUID().replace(/-/g, "")}`;
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
    ...attachments.flatMap((att) => [
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${encodeHeaderWord(att.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encodeHeaderWord(att.filename)}"`,
      "",
      wrapBase64(att.base64Data),
      "",
    ]),
    `--${boundary}--`,
  ];
  return [...headerLines, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

export interface SendReplyInput {
  to: string;
  subject: string;
  body: string;
  threadId: string;
  attachments?: MailAttachment[];
}

export async function sendReply(accessToken: string, input: SendReplyInput): Promise<void> {
  const subject = input.subject.startsWith("Re:") ? input.subject : `Re: ${input.subject}`;
  const raw = buildRawMessage({ to: input.to, subject }, input.body, input.attachments ?? []);
  await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(raw), threadId: input.threadId }),
  });
}

export interface SendNewMailInput {
  to: string;
  subject: string;
  body: string;
  attachments?: MailAttachment[];
}

/** Sends a brand-new message (no threadId — starts its own thread), as opposed to sendReply()
 * which replies within an existing synced email's thread. Used by the Gmail compose FAB. */
export async function sendNewMail(accessToken: string, input: SendNewMailInput): Promise<void> {
  const raw = buildRawMessage({ to: input.to, subject: input.subject }, input.body, input.attachments ?? []);
  await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(raw) }),
  });
}

/** Authoritative check against Gmail itself for whether a reply actually went out on this
 * thread, rather than trusting only this app's own optimistic local status. Used two ways:
 * (1) when sendReply() throws (e.g. the request reached Gmail and sent but the response
 * was lost to a network drop), so a genuinely-sent reply never gets stuck showing as
 * "failed" locally; (2) during inbox sync, to catch replies sent from another device or
 * Gmail client directly, which this app would otherwise have no way to learn about.
 * Gmail applies the SENT label to a message regardless of which "send as" alias was used,
 * so that's checked instead of comparing From-header addresses. format=minimal is enough:
 * labelIds/internalDate are core message fields returned at every format level. */
export async function threadHasSentReplyAfter(accessToken: string, threadId: string, afterEpochMs: number): Promise<boolean> {
  const data = await gmailFetch(accessToken, `/threads/${threadId}?format=minimal`);
  const messages = (data.messages ?? []) as { internalDate?: string; labelIds?: string[] }[];
  return messages.some((m) => (m.labelIds ?? []).includes("SENT") && Number(m.internalDate ?? 0) >= afterEpochMs);
}
