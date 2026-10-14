import { describe, expect, it } from "vitest";
import type { TripExpense } from "../types";
import { MAX_MEMBERS, normalizeMembers, settlementTransfers, splitExpenses } from "./tripMembers";

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

describe("settlementTransfers(精算の仕方、2026-10-14)", () => {
  const exp = (amount: number, paidBy?: string) => ({ id: `${amount}${paidBy}`, tripId: "t", title: "x", amount, category: "other" as const, paid: true, paidBy, createdAt: 0 });

  it("2人: 払う人が受け取る人へ、差額を渡す1回で済む", () => {
    const split = splitExpenses([exp(17000, "えっくん"), exp(3000, "ふなだ")], ["ふなだ", "えっくん"])!;
    expect(settlementTransfers(split)).toEqual([{ from: "ふなだ", to: "えっくん", amount: 7000 }]);
  });

  it("3人: 全員の差額が0になる。渡す人は払う額の大きい人から、受け取る人は受け取る額の大きい人から", () => {
    const split = splitExpenses([exp(9000, "A"), exp(3000, "B")], ["A", "B", "C"])!;
    // 合計12000・1人4000。A +5000・B -1000・C -4000。
    const transfers = settlementTransfers(split);
    expect(transfers).toEqual([
      { from: "C", to: "A", amount: 4000 },
      { from: "B", to: "A", amount: 1000 },
    ]);
    const net = new Map<string, number>();
    for (const t of transfers) {
      net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
      net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
    }
    for (const member of split.members) expect(net.get(member.name) ?? 0).toBe(Math.round(member.balance));
  });

  it("割り切れない額(円の端数)でも、渡す額の合計と受け取る額の合計が必ず一致する", () => {
    const split = splitExpenses([exp(1000, "A")], ["A", "B", "C"])!;
    const transfers = settlementTransfers(split);
    const paid = transfers.reduce((sum, t) => sum + t.amount, 0);
    // 1000 ÷ 3 = 333.33…。B・C は 333 円ずつ。円に丸めて出る 1 円のずれは、受け取る A が持つ(A が受け取るのは 666 円)。
    expect(paid).toBe(666);
    expect(transfers.map((t) => t.amount)).toEqual([333, 333]);
    expect(transfers.every((t) => Number.isInteger(t.amount) && t.amount > 0)).toBe(true);
    expect(transfers.every((t) => t.to === "A")).toBe(true);
  });

  it("差額が全員0なら、渡す人はいない", () => {
    expect(settlementTransfers(splitExpenses([exp(5000, "A"), exp(5000, "B")], ["A", "B"])!)).toEqual([]);
    expect(settlementTransfers(splitExpenses([], ["A", "B"])!)).toEqual([]);
  });
});
