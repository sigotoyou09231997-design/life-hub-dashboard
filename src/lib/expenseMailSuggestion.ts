import type { SyncedEmail } from "../types";
import { detectPlanSignals, isPromoText } from "./mailPlanSuggestion";
import { parseSender } from "./gmail";
import { toDateStr } from "./date";

/**
 * 注文確認・領収書のメールから、支出の候補(金額・店名・日付)を拾う。
 *
 * ここでAIは使わない — 予定の提案(src/lib/mailPlanSuggestion.ts)・就活の提案
 * (src/lib/jobMailSuggestion.ts)と同じ考え方で、届いたメールを片っ端からAIに
 * 読ませるとAPI呼び出しがそのぶん増える。当たりを付けるのも読み取るのも、
 * 端末の中の文字合わせだけで済ませる(この仕組みではAIを一度も呼ばない)。
 *
 * 見ているのは差出人・件名・抜粋(snippet)と、取り込んであれば本文の頭(planText)。
 * 提案止まりで、本人が押すまで支出は増えない。
 */

/** 全角の数字と記号を半角に揃える。「￥１，２３４」を取りこぼさないため。 */
function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[￥]/g, "¥")
    .replace(/[，]/g, ",")
    .replace(/[：]/g, ":");
}

/** 買い物らしいメールの言葉。1つも無ければ、金額が書いてあっても候補にしない。 */
const EXPENSE_KEYWORDS = [
  "領収",
  "レシート",
  "ご注文",
  "注文確認",
  "注文内容",
  "ご購入",
  "お買い上げ",
  "お支払い",
  "お支払方法",
  "支払い完了",
  "決済",
  "ご請求",
  "請求書",
  "利用明細",
  "ご利用明細",
  "カード利用",
  "発送",
  "出荷",
  "予約完了",
  "受付完了",
];

/**
 * 金額のすぐ前に来ると「これが払った額」と分かる言葉。同じメールに小計・送料・
 * ポイントが並ぶので、この言葉が近くにある数字を優先して採る。
 */
const TOTAL_KEYWORDS = ["合計", "総額", "請求", "支払", "お買い上げ", "決済", "ご利用金額", "利用金額"];

/** 金額として受け取る範囲。1円未満と1千万円超えは、桁の読み違いとして捨てる。 */
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 10_000_000;

/** 金額の前をどこまで遡って TOTAL_KEYWORDS を探すか(文字数)。 */
const KEYWORD_LOOKBEHIND = 12;

interface AmountCandidate {
  amount: number;
  /** 合計らしい言葉が近くにあれば2、無ければ1。 */
  priority: number;
}

/**
 * 本文から支払い額を1つ選ぶ。
 *
 * 「合計」などの言葉が近くにある数字を優先し、同じ優先度なら大きい方を採る —
 * 注文確認メールでは小計・送料・ポイントが並び、いちばん大きい数字が支払額に
 * なることが多い。読めなければ undefined。
 */
export function detectAmount(text: string): number | undefined {
  const normalized = normalizeText(text);
  const candidates: AmountCandidate[] = [];

  const patterns = [/¥\s*([\d,]+)/g, /([\d,]+)\s*円/g];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const amount = Number(match[1].replace(/,/g, ""));
      if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) continue;
      const before = normalized.slice(Math.max(0, match.index - KEYWORD_LOOKBEHIND), match.index);
      candidates.push({ amount, priority: TOTAL_KEYWORDS.some((word) => before.includes(word)) ? 2 : 1 });
    }
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.priority - a.priority || b.amount - a.amount);
  return candidates[0].amount;
}

/**
 * 店名。差出人の表示名をそのまま使う — 注文確認メールの差出人はほぼ店の名前で、
 * 本文から店名を当てにいくより外さない。表示名が無いメールはアドレスの
 * ドメインの頭(amazon.co.jp なら amazon)を使う。
 */
export function detectStore(from: string): string {
  const sender = parseSender(from);
  const name = sender.name?.trim();
  // 「Amazon.co.jp <auto-confirm@...>」のような表示名はそのまま店名として読める。
  if (name && name !== sender.email) return name;
  const domain = sender.email.split("@")[1] ?? "";
  const head = domain.split(".")[0];
  return head || sender.email || "";
}

export interface ExpenseSuggestion {
  /** 支払い額(円)。 */
  amount: number;
  /** 店名。 */
  store: string;
  /** 支出の日(YYYY-MM-DD)。本文に日付があればそれ、無ければメールが届いた日。 */
  date: string;
  /** 「¥3,480・Amazon.co.jp」のような、何を見つけたかの一言。 */
  hint: string;
}

type SuggestionEmail = Pick<SyncedEmail, "from" | "subject" | "snippet" | "status"> & {
  receivedAt?: number;
  planText?: string;
  expenseSuggestionDismissedAt?: number;
};

/** 判定に使う文章。予定の提案と同じで、件名・抜粋に加えて本文の頭も見る。 */
function expenseSourceText(email: Pick<SuggestionEmail, "subject" | "snippet" | "planText">): string {
  return [email.subject, email.snippet, email.planText ?? ""].join(" ");
}

export function hasExpenseKeyword(text: string): boolean {
  const normalized = normalizeText(text);
  return EXPENSE_KEYWORDS.some((word) => normalized.includes(word));
}

/**
 * このメールを「支出に追加しますか?」として出すか。
 *
 * 買い物らしい言葉と金額の両方が揃っているものだけ。本人が「あとで」を押した
 * メールと、スキップしたメールは出さない。宣伝メール(セール告知など)も、
 * 金額と「ご購入」が揃ってしまうので出さない。
 */
export function isExpenseSuggestion(email: SuggestionEmail): boolean {
  if (email.expenseSuggestionDismissedAt) return false;
  if (email.status === "skipped") return false;
  const text = expenseSourceText(email);
  if (isPromoText(text)) return false;
  if (!hasExpenseKeyword(text)) return false;
  return detectAmount(text) !== undefined;
}

/** 候補の中身。候補にならないメールは null。 */
export function toExpenseSuggestion(email: SuggestionEmail): ExpenseSuggestion | null {
  if (!isExpenseSuggestion(email)) return null;
  const text = expenseSourceText(email);
  const amount = detectAmount(text);
  if (amount === undefined) return null;

  const store = detectStore(email.from);
  // 日付は本文にあればそれを採る。無ければメールが届いた日 —
  // 注文確認・領収書はその日のうちに届くので、届いた日でほぼ合う。
  const signals = detectPlanSignals(text, email.receivedAt);
  const date = signals.dates[0] ?? toDateStr(email.receivedAt ? new Date(email.receivedAt) : new Date());

  return {
    amount,
    store,
    date,
    hint: [`¥${amount.toLocaleString()}`, store].filter(Boolean).join("・"),
  };
}

/** 提案に添える一言。候補でなければ空文字。 */
export function expenseSuggestionHint(email: SuggestionEmail): string {
  return toExpenseSuggestion(email)?.hint ?? "";
}

/** 提案として出せるメールだけを、渡された順のまま返す。 */
export function pickExpenseSuggestions<T extends SuggestionEmail>(emails: T[]): T[] {
  return emails.filter((email) => isExpenseSuggestion(email));
}
