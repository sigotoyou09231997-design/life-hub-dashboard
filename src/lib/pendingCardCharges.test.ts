import { describe, expect, it } from "vitest";
import type { PendingCardCharge, Transaction } from "../types";
import {
  isSettled,
  planPendingImport,
  settledExternalId,
  unsettledCharges,
  unsettledTotal,
} from "./pendingCardCharges";

function charge(over: Partial<PendingCardCharge> & { externalId: string; date: string; amount: number }): PendingCardCharge {
  return { importedAt: 1_000, createdAt: 1_000, ...over };
}

function expense(over: Partial<Transaction> & { date: string; amount: number }): Transaction {
  return { type: "expense", category: "その他", isFixed: false, createdAt: 0, ...over };
}

describe("isSettled", () => {
  const row = charge({ externalId: "x1", date: "2026-08-20", amount: 3_480 });

  it("この画面から作った支出(印が一致)は記録済み", () => {
    const t = expense({ date: "2026-08-20", amount: 3_480, externalId: settledExternalId("x1") });
    expect(isSettled(row, [t])).toBe(true);
  });

  it("印が無くても、利用日と金額が両方一致する支出があれば記録済みとみなす", () => {
    expect(isSettled(row, [expense({ date: "2026-08-20", amount: 3_480 })])).toBe(true);
  });

  it("日付か金額のどちらかが違えば、まだ記録されていない", () => {
    expect(isSettled(row, [expense({ date: "2026-08-21", amount: 3_480 })])).toBe(false);
    expect(isSettled(row, [expense({ date: "2026-08-20", amount: 3_481 })])).toBe(false);
  });

  it("収入の行は突き合わせの相手にしない", () => {
    const income = expense({ date: "2026-08-20", amount: 3_480, type: "income" });
    expect(isSettled(row, [income])).toBe(false);
  });

  it("支出を消せば、また未確定に戻る(印を行に持たないため)", () => {
    const t = expense({ date: "2026-08-20", amount: 3_480, externalId: settledExternalId("x1") });
    expect(isSettled(row, [t])).toBe(true);
    expect(isSettled(row, [])).toBe(false);
  });
});

describe("unsettledCharges", () => {
  it("記録済みを外して、新しい利用が上に来る順で返す", () => {
    const rows = [
      charge({ externalId: "a", date: "2026-08-10", amount: 100 }),
      charge({ externalId: "b", date: "2026-08-20", amount: 200 }),
      charge({ externalId: "c", date: "2026-08-15", amount: 300 }),
    ];
    const transactions = [expense({ date: "2026-08-15", amount: 300 })];
    expect(unsettledCharges(rows, transactions).map((c) => c.externalId)).toEqual(["b", "a"]);
  });
});

describe("unsettledTotal", () => {
  const rows = [
    charge({ externalId: "a", date: "2026-08-10", amount: 1_000 }),
    charge({ externalId: "b", date: "2026-08-25", amount: 2_000 }),
    charge({ externalId: "c", date: "2026-08-28", amount: 3_000 }),
  ];

  it("期の初日より前の利用は数えない(前の期の給与から払うぶんのため)", () => {
    expect(unsettledTotal(rows, [], "2026-08-25")).toBe(5_000);
  });

  it("記録済みのぶんは差し引く", () => {
    const transactions = [expense({ date: "2026-08-28", amount: 3_000 })];
    expect(unsettledTotal(rows, transactions, "2026-08-25")).toBe(2_000);
  });

  it("1件も無ければ0", () => {
    expect(unsettledTotal([], [], "2026-08-01")).toBe(0);
  });
});

describe("planPendingImport", () => {
  it("すでに取り込んだ行は飛ばす", () => {
    const existing = [charge({ externalId: "a", date: "2026-08-10", amount: 100 })];
    const plan = planPendingImport(
      [
        { externalId: "a", date: "2026-08-10", amount: 100 },
        { externalId: "b", date: "2026-08-11", amount: 200 },
      ],
      existing,
    );
    expect(plan.added.map((d) => d.externalId)).toEqual(["b"]);
    expect(plan.duplicates).toBe(1);
  });

  it("同じCSVの中で重複していても1件だけ足す", () => {
    const plan = planPendingImport(
      [
        { externalId: "a", date: "2026-08-10", amount: 100 },
        { externalId: "a", date: "2026-08-10", amount: 100 },
      ],
      [],
    );
    expect(plan.added).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
  });
});
