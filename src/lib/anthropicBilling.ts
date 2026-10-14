import type { GmailAccount } from "../types";
import { ensureFreshAccessToken, getMessageBody, getMessageMeta, listMessageIdsByQuery, mapWithConcurrency } from "./gmail";

/**
 * Anthropic(Claude)の料金を、Gmail に届く領収書から月ごとに集める(2026-10-14、本人「Anthropic の料金も月ごとに、Claude の枠に出したい」)。
 *
 * Claude のサブスク(Pro / Max)と、API のクレジット(単発の購入・残高が減った時の自動補充)は、どちらも
 * 「Your receipt from Anthropic, PBC」という領収書メールで届く。それを読んで、月ごとに「サブスク」と「追加(API クレジット)」に分ける。
 * 支払いに失敗した通知(「payment to Anthropic, PBC was unsuccessful」)も拾って、画面で知らせる。
 *
 * 金額はドル建て(領収書のまま。消費税込み)。円は目安(下の USD_JPY)。この端末の中だけに覚える(領収書はいつでも Gmail から読み直せる)。
 * AI は使わない(領収書の形は決まっているので、読み取りは決まりきった文字の拾い出しだけ)。
 */

/** 円に直す目安。サブスクのお手本(src/lib/subscriptionTemplates.ts)と同じ、1ドル150円。実際のカードの請求額とは少し違う。 */
export const USD_JPY = 150;

export type ReceiptKind = "subscription" | "credit" | "other";

export interface AnthropicReceipt {
  /** Gmail のメールの id(読み直しを避けるための印)。 */
  messageId: string;
  receiptNo: string;
  /** 支払った日(YYYY-MM-DD)。月ごとの集計はこの日で分ける。 */
  paidOn: string;
  /** 税込みの合計(ドル)。 */
  total: number;
  /** 税(ドル)。 */
  tax: number;
  kind: ReceiptKind;
  /** 画面に出す名前(「Claude Max 5x」「クレジットの自動補充」など)。 */
  label: string;
}

export interface FailedPayment {
  messageId: string;
  /** 失敗の通知が届いた日(YYYY-MM-DD)。 */
  on: string;
  /** 払おうとした金額(ドル)。 */
  amount: number;
}

export interface MonthSummary {
  /** YYYY-MM。 */
  month: string;
  subscription: number;
  credit: number;
  other: number;
  total: number;
  count: number;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const toNumber = (text: string): number => Number(text.replace(/,/g, ""));
const two = (n: number): string => String(n).padStart(2, "0");

/** 「July 20, 2026」→「2026-07-20」。読めなければ null。 */
function parseEnglishDate(month: string, day: string, year: string): string | null {
  const m = MONTHS[month.toLowerCase()];
  if (!m) return null;
  return `${year}-${two(m)}-${two(Number(day))}`;
}

/** 領収書の行の中身から、種類と画面に出す名前を決める。 */
function describeLines(lines: string): { kind: ReceiptKind; label: string } {
  const plan = lines.match(/Max plan\s*-\s*(\d+x)/i) ?? lines.match(/Claude\s+Max\s*(\d+x)?/i);
  if (plan) return { kind: "subscription", label: `Claude Max${plan[1] ? ` ${plan[1]}` : ""}` };
  const named = lines.match(/Claude\s+(Pro|Team|Enterprise)/i);
  if (named) return { kind: "subscription", label: `Claude ${named[1]}` };
  if (/auto-?recharge/i.test(lines)) return { kind: "credit", label: "クレジットの自動補充" };
  if (/credit/i.test(lines)) return { kind: "credit", label: "クレジットの購入(単発)" };
  return { kind: "other", label: "その他" };
}

/**
 * 領収書メールの本文(文章にしたもの)を読む。領収書と読めなければ null。
 * 改行の入り方はメールによって違うので、空白を全部ひとつに詰めてから読む。
 */
export function parseReceipt(text: string, messageId = ""): AnthropicReceipt | null {
  const t = text.replace(/\s+/g, " ");
  const header = t.match(/Receipt from Anthropic, PBC \$([\d,]+\.\d{2}) Paid ([A-Za-z]+) (\d{1,2}), (\d{4})/i);
  const paidOn = header ? parseEnglishDate(header[2], header[3], header[4]) : null;
  const total = header ? toNumber(header[1]) : NaN;
  if (!paidOn || !Number.isFinite(total)) return null;

  const receiptNo = t.match(/Receipt #(\d{4}-\d{4}-\d{4})/i)?.[1] ?? t.match(/Receipt number (\d{4}-\d{4}-\d{4})/i)?.[1] ?? "";
  // 行の部分(「Receipt #…」から「Subtotal」まで)で、サブスクかクレジットかを見分ける。
  const body = t.match(/Receipt #\d{4}-\d{4}-\d{4}(.*?)(?:Subtotal|Total excluding tax)/i)?.[1] ?? "";
  const { kind, label } = describeLines(body);
  // 税は「合計 − 税抜きの合計」。税の行の名前(JCT・Tax・VAT…)は国で違うので、名前では探さない。
  const net = t.match(/Total excluding tax \$([\d,]+\.\d{2})/i);
  const tax = net ? Math.round((total - toNumber(net[1])) * 100) / 100 : 0;
  return { messageId, receiptNo, paidOn, total, tax, kind, label };
}

/** 支払い失敗の通知(件名「$11.02 payment to Anthropic, PBC was unsuccessful」)を読む。 */
export function parseFailedPayment(subject: string, receivedAtMs: number, messageId = ""): FailedPayment | null {
  const match = subject.match(/\$([\d,]+\.\d{2}) payment to Anthropic.*unsuccessful/i);
  if (!match || !Number.isFinite(receivedAtMs)) return null;
  const date = new Date(receivedAtMs);
  // 画面に出す日は、この端末の日付(日本なら日本の日付)。
  return { messageId, on: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`, amount: toNumber(match[1]) };
}

/** 月ごとの合計(新しい月が先)。同じ領収書(同じ番号)が二重に入っていても1回だけ数える。 */
export function summarizeByMonth(receipts: AnthropicReceipt[]): MonthSummary[] {
  const seen = new Set<string>();
  const months = new Map<string, MonthSummary>();
  for (const receipt of receipts) {
    const key = receipt.receiptNo || receipt.messageId;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const month = receipt.paidOn.slice(0, 7);
    const row = months.get(month) ?? { month, subscription: 0, credit: 0, other: 0, total: 0, count: 0 };
    row[receipt.kind] += receipt.total;
    row.total += receipt.total;
    row.count += 1;
    months.set(month, row);
  }
  // 浮動小数の足し算の端数(0.1+0.2 のような)を、セント単位に丸める。
  const cents = (n: number) => Math.round(n * 100) / 100;
  return [...months.values()]
    .map((row) => ({ ...row, subscription: cents(row.subscription), credit: cents(row.credit), other: cents(row.other), total: cents(row.total) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export function usdToYen(usd: number): number {
  return Math.round(usd * USD_JPY);
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

// ── この端末の中に覚える ──────────────────────────────────────────────────

const STORAGE_KEY = "lifeHubAnthropicBilling";

export interface BillingData {
  receipts: AnthropicReceipt[];
  failed: FailedPayment[];
  /** 最後に Gmail から読んだ時刻(epoch ms)。 */
  fetchedAt: number | null;
}

export const EMPTY_BILLING: BillingData = { receipts: [], failed: [], fetchedAt: null };

export function loadBilling(): BillingData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_BILLING;
    const parsed = JSON.parse(raw) as Partial<BillingData>;
    return {
      receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : null,
    };
  } catch {
    return EMPTY_BILLING;
  }
}

function saveBilling(data: BillingData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 覚えられなくても、今回の画面には出る。
  }
}

/** 領収書メール・失敗の通知メールを探す式。 */
const RECEIPT_QUERY = "from:invoice+statements@mail.anthropic.com";
const FAILED_QUERY = "from:failed-payments@mail.anthropic.com";
/** 1回に読むメールの数の上限(領収書は月に数通なので、5年ぶんは入る)。 */
const MAX_MESSAGES = 100;

export interface RefreshResult extends BillingData {
  /** 今回、新しく読んだ領収書の数。 */
  added: number;
  /** 領収書のはずなのに、読み取れなかったメールの数。 */
  unreadable: number;
}

/**
 * Gmail から領収書を読み直して、覚える。すでに読んだメールは読み直さない(新しいものだけ)。
 * 領収書のメールが1通も無くても、エラーにはしない(空のまま)。通信・権限の失敗は、そのまま投げる。
 */
export async function refreshBilling(account: GmailAccount, previous: BillingData = loadBilling()): Promise<RefreshResult> {
  const fresh = await ensureFreshAccessToken(account);
  const token = fresh.accessToken;

  const knownReceipts = new Set(previous.receipts.map((receipt) => receipt.messageId));
  const knownFailed = new Set(previous.failed.map((failure) => failure.messageId));

  const receiptIds = (await listMessageIdsByQuery(token, RECEIPT_QUERY, MAX_MESSAGES)).filter((id) => !knownReceipts.has(id));
  const failedIds = (await listMessageIdsByQuery(token, FAILED_QUERY, 20)).filter((id) => !knownFailed.has(id));

  const added: AnthropicReceipt[] = [];
  let unreadable = 0;
  await mapWithConcurrency(receiptIds, 3, async (id) => {
    const body = await getMessageBody(token, id).catch(() => "");
    const receipt = parseReceipt(body, id);
    if (receipt) added.push(receipt);
    else unreadable += 1;
  });

  const failures: FailedPayment[] = [];
  await mapWithConcurrency(failedIds, 3, async (id) => {
    const meta = await getMessageMeta(token, id).catch(() => null);
    const failure = meta ? parseFailedPayment(meta.subject, meta.receivedAt, id) : null;
    if (failure) failures.push(failure);
  });

  const next: BillingData = {
    receipts: [...previous.receipts, ...added],
    failed: [...previous.failed, ...failures].sort((a, b) => b.on.localeCompare(a.on)),
    fetchedAt: Date.now(),
  };
  saveBilling(next);
  return { ...next, added: added.length, unreadable };
}

/** サブスクが Claude(Anthropic)のものか。名前か、お手本の印で見分ける。 */
export function isClaudeSubscription(title: string, serviceKey?: string | null): boolean {
  return /claude|anthropic/i.test(title) || Boolean(serviceKey && /^claude/i.test(serviceKey));
}
