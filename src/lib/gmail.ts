import { db } from "../db/schema";
import type { EmailStatus, GmailAccount, SyncedEmail } from "../types";

const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
/** Refresh proactively so a call never starts on a token that expires mid-request. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
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

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${name} failed (${res.status}): ${text}`);
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

export interface GenerateDraftInput {
  from: string;
  subject: string;
  body: string;
}

export async function generateDraft(input: GenerateDraftInput): Promise<string> {
  const result = await callFunction<{ draft: string }>("generateDraft", input);
  return result.draft;
}

/** Fetches the email body, asks the AI to draft a reply, and upserts it into
 * draftReplies (one row per email, updated in place on regenerate). Shared by
 * the inbox's per-row/bulk "AI下書きを作成" and the review sheet's "再生成". */
export async function generateDraftForEmail(account: GmailAccount, email: SyncedEmail): Promise<string> {
  if (!email.id || !account.id) throw new Error("email/account is missing an id");
  const emailId = email.id;
  const fallbackStatus: EmailStatus =
    email.status === "drafted" || email.status === "edited" || email.status === "sent" ? email.status : "unprocessed";

  await db.syncedEmails.update(emailId, { status: "generating" });
  try {
    const fresh = await ensureFreshAccessToken(account);
    const body = await getMessageBody(fresh.accessToken, email.gmailMessageId);
    const draft = await generateDraft({ from: email.from, subject: email.subject, body: body || email.snippet });
    const now = Date.now();
    const existing = await db.draftReplies.where("emailId").equals(emailId).first();
    if (existing?.id) {
      await db.draftReplies.update(existing.id, { body: draft, updatedAt: now });
    } else {
      await db.draftReplies.add({ emailId, accountId: account.id, body: draft, createdAt: now, updatedAt: now });
    }
    await db.syncedEmails.update(emailId, { status: "drafted" });
    return draft;
  } catch (err) {
    await db.syncedEmails.update(emailId, { status: fallbackStatus });
    throw err;
  }
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
  const params = new URLSearchParams({ q: `after:${sinceEpochSec}`, maxResults: "100" });
  const data = await gmailFetch(accessToken, `/messages?${params.toString()}`);
  return ((data.messages ?? []) as { id: string }[]).map((m) => m.id);
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

const AVATAR_COLORS = [
  "bg-rose-400",
  "bg-orange-400",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
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

export interface SendReplyInput {
  to: string;
  subject: string;
  body: string;
  threadId: string;
}

export async function sendReply(accessToken: string, input: SendReplyInput): Promise<void> {
  const subject = input.subject.startsWith("Re:") ? input.subject : `Re: ${input.subject}`;
  const lines = [
    `To: ${input.to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  const raw = `${lines.join("\r\n")}\r\n\r\n${input.body}`;
  await gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(raw), threadId: input.threadId }),
  });
}
