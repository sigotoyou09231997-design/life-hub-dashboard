import { collectStoreSamples, guessCategoryFromStore } from "./storeCategory";
import type { Transaction } from "../types";

/**
 * 検索欄に「ランチ 1200」と打って、そのまま支出を1件記録する(UI/UX 調査メモ 第5弾 B-1、2026-10-13)。
 * ここは、打った文字から「店・品名」と「金額」を読み取る純粋な関数。画面は src/components/layout/GlobalSearch.tsx。
 *
 * **間違って記録しないための決め**(検索したい人の文字に、数字が混じることは多い):
 *  - 数字は、ちょうど1つだけ。2つ以上あれば、金額とは決めない(「2024 6 ランチ」など)。
 *  - 日付・時刻らしい数字(3月5日・10時・19:00・2026/10/13)が混じっていれば、予定の入力かもしれないので読み取らない。
 *  - 店・品名が無い(数字だけ)なら読み取らない。
 *  - 金額は 100円以上・1,000万円以下の整数。「iPhone 15」「Windows 11」の15や11を金額と取らないための下限。
 *  - 候補の行に出すだけで、記録は Enter(または押した時)だけ。出ているだけでは、何も保存しない。
 */

export interface QuickExpense {
  /** 店・品名(数字を除いた残り)。 */
  store: string;
  /** 金額(円)。 */
  amount: number;
}

export const QUICK_EXPENSE_MIN_AMOUNT = 100;
export const QUICK_EXPENSE_MAX_AMOUNT = 10_000_000;

/** 日付・時刻らしい言葉。含んでいたら、支出の入力とは見ない。 */
const DATE_OR_TIME = /\d\s*[月日時分秒年週]|\d\s*[:：\/／.．-]\s*\d|[月火水木金土日]曜|午前|午後|今日|明日|明後日|昨日|来週|今週/;

/** 金額の書き方: 1200 / 1,200 / ¥1200 / ¥1,200 / 1200円 / 1,200円。 */
const AMOUNT_TOKEN = /^[¥￥]?\d{1,3}(?:,\d{3})+円?$|^[¥￥]?\d+円?$/;

export function parseQuickExpense(raw: string): QuickExpense | null {
  // 全角の英数・記号を半角に(NFKC)。「１２００円」「ランチ　１２００」も同じに読む。
  const normalized = raw.normalize("NFKC").trim();
  if (!normalized || DATE_OR_TIME.test(normalized)) return null;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const amountTokens = tokens.filter((token) => /\d/.test(token));
  if (amountTokens.length !== 1) return null; // 数字のある語は、ちょうど1つ
  const amountToken = amountTokens[0];
  if (!AMOUNT_TOKEN.test(amountToken)) return null; // 「第3回」「15th」のように、数字に文字が付いた語は金額ではない

  const amount = Number(amountToken.replace(/[¥￥,円]/g, ""));
  if (!Number.isInteger(amount) || amount < QUICK_EXPENSE_MIN_AMOUNT || amount > QUICK_EXPENSE_MAX_AMOUNT) return null;

  const store = tokens.filter((token) => token !== amountToken).join(" ").trim();
  if (!store) return null;
  return { store, amount };
}

/**
 * よく使う言葉からのカテゴリ。過去の記録から推測できない時(店名の学習は src/lib/storeCategory.ts)の、2番目の手がかり。
 * 少なく・外しにくい言葉だけにしてある。候補の行にカテゴリを出すので、記録する前に必ず見える。
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  食費: ["ランチ", "ディナー", "朝食", "昼食", "夕食", "晩ご飯", "昼ご飯", "ごはん", "外食", "弁当", "コンビニ", "スーパー", "カフェ", "コーヒー", "ラーメン", "居酒屋", "パン", "牛乳", "食材", "おやつ"],
  日用品: ["洗剤", "ティッシュ", "トイレットペーパー", "シャンプー", "日用品", "ドラッグストア", "100均", "ダイソー"],
  交通費: ["電車", "バス", "タクシー", "ガソリン", "駐車", "高速", "切符", "新幹線", "suica", "pasmo", "交通費"],
  娯楽: ["映画", "ゲーム", "カラオケ", "ライブ", "漫画", "書籍", "サブスク", "遊園地"],
  交際費: ["飲み会", "プレゼント", "ギフト", "お土産", "香典", "ご祝儀", "懇親会", "お祝い"],
  医療: ["病院", "薬", "クリニック", "歯医者", "診察", "薬局"],
  美容: ["美容院", "散髪", "ヘアサロン", "ネイル", "化粧品"],
  教育: ["教材", "参考書", "学費", "セミナー", "講座", "資格"],
};

function keywordCategory(store: string): string | null {
  const text = store.normalize("NFKC").toLowerCase();
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((word) => text.includes(word.toLowerCase()))) return category;
  }
  return null;
}

/**
 * 記録するカテゴリを決める: ①過去に同じ店で選んだカテゴリ → ②言葉の手がかり → ③よく使う順の先頭(orderedCategories[0])。
 * どれで決まったかも返す(候補の行に出す一言のため)。
 */
export function resolveQuickCategory(
  store: string,
  pastTransactions: Transaction[],
  orderedCategories: readonly string[],
): { category: string; basis: "history" | "keyword" | "default" } {
  const past = guessCategoryFromStore(collectStoreSamples(pastTransactions), store);
  if (past) return { category: past.category, basis: "history" };
  const byWord = keywordCategory(store);
  if (byWord) return { category: byWord, basis: "keyword" };
  return { category: orderedCategories[0] ?? "その他", basis: "default" };
}
