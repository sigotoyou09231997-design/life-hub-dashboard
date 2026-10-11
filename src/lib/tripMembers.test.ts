import { describe, expect, it } from "vitest";
import type { TripExpense } from "../types";
import { MAX_MEMBERS, normalizeMembers, splitExpenses } from "./tripMembers";

function expense(amount: number, paidBy?: string): TripExpense {
  return { tripId: "t", title: "x", amount, category: "other", paid: true, paidBy, createdAt: 0 };
}

describe("参加者", () => {
  it("空白を落とし、空・重なりを除き、入れた順を保つ", () => {
    expect(normalizeMembers([" ふなだ ", "", "えっくん", "ふなだ", "ＡＢＣ"])).toEqual(["ふなだ", "えっくん", "ABC"]);
  });

  it(`${MAX_MEMBERS}人までにする`, () => {
    expect(normalizeMembers(Array.from({ length: 30 }, (_, i) => `人${i}`))).toHaveLength(MAX_MEMBERS);
  });
});

describe("割り勘", () => {
  it("参加者が2人未満なら出さない", () => {
    expect(splitExpenses([expense(1000, "a")], ["a"])).toBeNull();
    expect(splitExpenses([expense(1000)], undefined)).toBeNull();
  });

  it("払った額と1人あたり、差額(プラス=受け取る・マイナス=払う)を出す", () => {
    const split = splitExpenses([expense(17000, "えっくん"), expense(3000, "ふなだ")], ["ふなだ", "えっくん"])!;
    expect(split.total).toBe(20000);
    expect(split.perPerson).toBe(10000);
    expect(split.members).toEqual([
      { name: "ふなだ", paid: 3000, share: 10000, balance: -7000 },
      { name: "えっくん", paid: 17000, share: 10000, balance: 7000 },
    ]);
  });

  it("誰が払ったか決まっていない費用は割らない(全員が払う側になって、受け取る人がいなくならないように)", () => {
    // 画面で見つけた例: 払った人の決まっていない ¥12,000 まで割ると、2人とも「払う」になっていた。
    const split = splitExpenses(
      [expense(28000, "えっくん"), expense(36000, "ふなだ"), expense(12000)],
      ["ふなだ", "えっくん"],
    )!;
    expect(split.total).toBe(64000);
    expect(split.unassigned).toBe(12000);
    expect(split.members.map((m) => m.balance)).toEqual([4000, -4000]);
    expect(split.members.reduce((sum, m) => sum + m.balance, 0)).toBe(0);
  });

  it("参加者にいない名前で払った費用は、誰が払ったか決まっていない費用として数える", () => {
    const split = splitExpenses([expense(1000, "抜けた人")], ["a", "b"])!;
    expect(split.unassigned).toBe(1000);
  });
});
