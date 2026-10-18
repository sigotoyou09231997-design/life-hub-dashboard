import { describe, expect, it } from "vitest";
import { EXPENSE_INITIAL_TAB, EXPENSE_TABS, resolveExpenseTabRequest } from "./expenseTabs";

describe("お金管理のタブ(第8弾 M-1)", () => {
  it("並びはサマリー・履歴・サブスク・給与。初期表示はサマリー", () => {
    expect(EXPENSE_TABS).toEqual(["summary", "history", "subs", "salary"]);
    expect(EXPENSE_INITIAL_TAB).toBe("summary");
  });

  it("?new=expense は履歴タブを開いて新規フォームも開く", () => {
    expect(resolveExpenseTabRequest("expense", null)).toEqual({ tab: "history", openNew: "expense" });
  });

  it("?new=salary は給与タブを開いて新規フォームも開く", () => {
    expect(resolveExpenseTabRequest("salary", null)).toEqual({ tab: "salary", openNew: "salary" });
  });

  it("?tab= は、他の画面からの指定タブをそのまま開く(フォームは開かない)", () => {
    expect(resolveExpenseTabRequest(null, "subs")).toEqual({ tab: "subs" });
    expect(resolveExpenseTabRequest(null, "salary")).toEqual({ tab: "salary" });
  });

  it("どちらも無い・該当しない時は null(今のタブのまま)", () => {
    expect(resolveExpenseTabRequest(null, null)).toBeNull();
    expect(resolveExpenseTabRequest(null, "存在しない")).toBeNull();
    expect(resolveExpenseTabRequest("ほかの値", null)).toBeNull();
  });
});
