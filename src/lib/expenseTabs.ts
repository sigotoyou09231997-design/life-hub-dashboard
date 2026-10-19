export type ExpenseTab = "subs" | "fixed" | "summary" | "salary" | "history";

/** 並びと初期表示はサマリー・履歴・サブスク・給与(第8弾 M-1、2026-10-18)。よく見るものを前に。
 * 2026-10-20 に、家賃・光熱費などの「固定費」をサブスクの前に足した(src/lib/fixedCosts.ts)。 */
export const EXPENSE_TABS: ExpenseTab[] = ["summary", "history", "fixed", "subs", "salary"];
export const EXPENSE_INITIAL_TAB: ExpenseTab = "summary";

export interface ExpenseTabRequest {
  tab: ExpenseTab;
  /** 開いた直後にそのタブの新規フォームも開く(アプリアイコン長押し・ホームの「給与を登録する」)。 */
  openNew?: "expense" | "salary";
}

/**
 * URL の ?new=/?tab= から、開くべきタブを決める(第8弾 M-1)。該当しなければ null(何もしない=今のまま)。
 * ?tab= は他の画面から来た指定(ホームの「支出を見る」、まとめて検索の「サブスクを見る」など)で、
 * 並び替えてもこの指定は壊さない。
 */
export function resolveExpenseTabRequest(newParam: string | null, tabParam: string | null): ExpenseTabRequest | null {
  if (newParam === "expense") return { tab: "history", openNew: "expense" };
  if (newParam === "salary") return { tab: "salary", openNew: "salary" };
  if (tabParam && EXPENSE_TABS.includes(tabParam as ExpenseTab)) return { tab: tabParam as ExpenseTab };
  return null;
}
