import type { CategoryBudget, Transaction } from "../types";
import { EXPENSE_CATEGORIES } from "./categories";

/**
 * カテゴリごとの予算と、今期そこにいくら使ったか。
 *
 * 全体の予算(使えるお金 = 給与 - 固定費 - 使った分)は今までどおり給与から
 * 計算するもので、これはそこに足す形の「カテゴリごとの上限」。どちらも同じ
 * 給与期間(給料日から次の給料日まで)で見る — 画面に並ぶ数字の期間が揃わないと、
 * 「今期は残っているのに食費だけ超えている」といった読み方ができない。
 */

/** 予算に近づいたと見なす割合。ここを超えると色が変わる。 */
export const NEAR_LIMIT_RATIO = 80;

export interface CategoryBudgetStatus {
  category: string;
  /** 設定した上限(円)。 */
  budget: number;
  /** 今期そのカテゴリに使った額(円)。 */
  spent: number;
  /** 使った割合(%)。100を超え得る — 棒の側で頭打ちにする。 */
  ratio: number;
  /** 残り(円)。超えていればマイナス。 */
  remaining: number;
  over: boolean;
  /** 超えてはいないが、あと少しで届く。 */
  nearLimit: boolean;
}

/**
 * 予測を出し始めるまでに必要な日数。
 *
 * 期の初日に5,000円使っただけで「このペースだと15万円」と言い出さないための足切り。
 * 3日ぶんあれば、まとめ買いの1日が混ざっていても平均がある程度ならされる。
 */
export const FORECAST_MIN_ELAPSED_DAYS = 3;

export interface CategoryBudgetForecast {
  category: string;
  budget: number;
  spent: number;
  /** 今のペースのまま次の給料日まで使い続けたときの、期の合計見込み(円)。 */
  projected: number;
  /** 見込みが上限をいくら超えるか(円)。超えない見込みなら0。 */
  projectedOver: number;
  /** まだ超えていないが、このままだと超える見込み。画面と通知はこれを見る。 */
  willExceed: boolean;
}

/**
 * 「今のペースで使い続けると給料日までに超えそう」かどうか。
 *
 * 見込み = 1日あたりの支出(今期の支出 ÷ 経過日数) × 期の日数。
 * すでに超えているカテゴリは対象にしない — そちらは予測ではなく事実なので、
 * 既存の「予算を超えています」の側で出す。ここは超える前に知らせるためのもの。
 *
 * @param elapsedDays   期の初日から今日までの日数(今日を含む)。
 * @param remainingDays 今日から次の給料日までの残り日数。
 */
export function forecastFor(
  status: CategoryBudgetStatus,
  elapsedDays: number,
  remainingDays: number,
): CategoryBudgetForecast {
  const none: CategoryBudgetForecast = {
    category: status.category,
    budget: status.budget,
    spent: status.spent,
    projected: status.spent,
    projectedOver: 0,
    willExceed: false,
  };
  if (status.over || status.budget <= 0) return none;
  if (elapsedDays < FORECAST_MIN_ELAPSED_DAYS || remainingDays <= 0) return none;

  const perDay = status.spent / elapsedDays;
  const projected = Math.round(perDay * (elapsedDays + remainingDays));
  const projectedOver = Math.max(0, projected - status.budget);
  return { ...none, projected, projectedOver, willExceed: projectedOver > 0 };
}

/** 超える見込みのカテゴリだけ。はみ出しの大きい順(先に手を打ちたいものが上)。 */
export function forecastOverBudget(
  statuses: CategoryBudgetStatus[],
  elapsedDays: number,
  remainingDays: number,
): CategoryBudgetForecast[] {
  return statuses
    .map((status) => forecastFor(status, elapsedDays, remainingDays))
    .filter((forecast) => forecast.willExceed)
    .sort((a, b) => b.projectedOver - a.projectedOver);
}

/** 支出のカテゴリの並び(src/lib/categories.ts)に合わせる。予算を足した順に
 * 並べると、同じカテゴリがサマリーと設定で違う位置に出てしまう。
 * 一覧に無いカテゴリ(手入力で増えたもの)は後ろへ回して名前順。 */
export function sortCategoryBudgets<T extends { category: string }>(budgets: T[]): T[] {
  const rank = (category: string) => {
    const index = EXPENSE_CATEGORIES.indexOf(category);
    return index === -1 ? EXPENSE_CATEGORIES.length : index;
  };
  return [...budgets].sort(
    (a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category, "ja"),
  );
}

/** 支出をカテゴリごとに合計する。収入は数えない。固定費として記録した支出は
 * 数える — サマリーの「カテゴリ別支出」が前からその数え方で、同じ card の中で
 * 棒と予算の母数が違うと、どちらが本当の食費なのか読めなくなる。 */
export function spendingByCategory(transactions: Transaction[]): Map<string, number> {
  const byCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense") continue;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  }
  return byCategory;
}

/** 予算1件ぶんの状態。上限が0以下の行は「未設定」と同じなので呼び出し側で外す。 */
export function statusFor(budget: CategoryBudget, spent: number): CategoryBudgetStatus {
  const limit = Math.max(0, budget.monthlyAmount);
  const ratio = limit > 0 ? (spent / limit) * 100 : 0;
  const remaining = limit - spent;
  return {
    category: budget.category,
    budget: limit,
    spent,
    ratio,
    remaining,
    over: remaining < 0,
    nearLimit: remaining >= 0 && ratio >= NEAR_LIMIT_RATIO,
  };
}

/** 設定した予算を、今期の支出と突き合わせる。上限0円の行は落とす。 */
export function summarizeCategoryBudgets(
  budgets: CategoryBudget[],
  spentByCategory: Map<string, number>,
): CategoryBudgetStatus[] {
  return sortCategoryBudgets(budgets)
    .filter((budget) => budget.monthlyAmount > 0)
    .map((budget) => statusFor(budget, spentByCategory.get(budget.category) ?? 0));
}

/** 超えているカテゴリだけ。超えた額の大きい順 — 見出しに1行で出すとき、
 * どれから直せばいいかが先に来るようにする。 */
export function overBudgetCategories(statuses: CategoryBudgetStatus[]): CategoryBudgetStatus[] {
  return statuses.filter((s) => s.over).sort((a, b) => a.remaining - b.remaining);
}

export function totalCategoryBudget(budgets: CategoryBudget[]): number {
  return budgets.reduce((sum, budget) => sum + Math.max(0, budget.monthlyAmount), 0);
}

/** まだ予算を付けていないカテゴリ(設定画面の追加候補)。 */
export function unbudgetedCategories(budgets: CategoryBudget[]): string[] {
  const used = new Set(budgets.map((b) => b.category));
  return EXPENSE_CATEGORIES.filter((category) => !used.has(category));
}
