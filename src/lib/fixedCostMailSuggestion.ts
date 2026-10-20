import type { SyncedEmail } from "../types";
import { detectAmount, detectStore } from "./expenseMailSuggestion";
import { isPromoText } from "./mailPlanSuggestion";
import type { FixedCostDraft } from "./fixedCosts";

/**
 * 料金のお知らせ・請求のメールから、固定費の下書きを作る(2026-10-20、本人「固定費も…メールから」)。
 *
 * 支出の提案(src/lib/expenseMailSuggestion.ts)と同じく、端末の中の文字合わせだけで AI は呼ばない。
 * 読み違いはあるので、必ず固定費のフォームで本人が確かめてから保存する。
 */
type FixedCostMail = Pick<SyncedEmail, "from" | "subject" | "snippet" | "status"> & {
  planText?: string;
  expenseSuggestionDismissedAt?: number;
};

/** 毎月(年に1回)決まって払うものの案内らしい言葉。 */
const BILL_WORDS = [
  "ご請求",
  "請求金額",
  "ご利用料金",
  "ご利用金額",
  "料金のお知らせ",
  "料金確定",
  "電気料金",
  "ガス料金",
  "水道料金",
  "使用量のお知らせ",
  "口座振替",
  "口座引落",
  "引き落とし",
  "引落",
  "保険料",
  "家賃",
  "賃料",
  "ご返済",
  "返済額",
  "通信料",
  "月額",
];

/** 種類と、名前の決め方(上から順に見る)。 */
const KINDS: { category: string; test: RegExp; title?: (text: string) => string | null }[] = [
  {
    category: "水道光熱費",
    test: /電気|でんき|電力|ガス|水道|下水/,
    title: (text) => (/ガス/.test(text) ? "ガス代" : /水道|下水/.test(text) ? "水道代" : "電気代"),
  },
  {
    category: "通信費",
    test: /携帯|スマホ|モバイル|通信料|ドコモ|docomo|ソフトバンク|softbank|ahamo|povo|linemo|uq|ワイモバイル|光回線|プロバイダ|インターネット|wi-?fi/i,
    title: (text) => (/光回線|プロバイダ|インターネット|wi-?fi/i.test(text) ? "インターネット" : "スマホ"),
  },
  { category: "家賃", test: /家賃|賃料|管理費|共益費/, title: () => "家賃" },
  { category: "保険", test: /保険/ },
  { category: "ローン", test: /ローン|ご返済|返済額|奨学金/ },
  { category: "税金・年金", test: /税|年金/ },
  { category: "カード", test: /カード.*(ご利用|ご請求)|(ご利用|ご請求).*カード/ },
];

function sourceText(email: FixedCostMail): string {
  return [email.subject, email.snippet, email.planText ?? ""].join(" ");
}

/** 本文の「口座振替日 10月26日」「お支払期限：2026年11月4日」などから、払う日の「日」を取る。無ければ undefined。 */
export function detectPayDay(text: string): number | undefined {
  const match = /(?:振替日|引落日|引き落とし日|引落し日|お支払(?:い)?期限|お支払(?:い)?日|支払期日|お引き落とし)[^0-9]{0,12}(?:\d{4}\s*[年/.-]\s*)?\d{1,2}\s*[月/.-]\s*(\d{1,2})/.exec(text);
  if (!match) return undefined;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : undefined;
}

/** 固定費の案内のメールか(料金・請求の言葉と金額がそろっていて、宣伝ではなく、「あとで」にしていない)。 */
export function isFixedCostMail(email: FixedCostMail): boolean {
  if (email.expenseSuggestionDismissedAt) return false;
  if (email.status === "skipped") return false;
  const text = sourceText(email);
  if (isPromoText(text)) return false;
  if (!BILL_WORDS.some((word) => text.includes(word))) return false;
  return detectAmount(text) !== undefined;
}

/** メールから固定費の下書きを作る。固定費の案内らしくなければ null。 */
export function toFixedCostDraft(email: FixedCostMail): FixedCostDraft | null {
  if (!isFixedCostMail(email)) return null;
  const text = sourceText(email);
  const store = detectStore(email.from);
  const haystack = `${text} ${store}`;
  const kind = KINDS.find((candidate) => candidate.test.test(haystack));
  const title = kind?.title?.(haystack) ?? store;
  return {
    title: title || undefined,
    category: kind?.category ?? "その他の固定費",
    amount: detectAmount(text),
    cycle: /年額|年払い|1年分|年間保険料/.test(text) ? "yearly" : "monthly",
    dueDay: detectPayDay(text),
  };
}
