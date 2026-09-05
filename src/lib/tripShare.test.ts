/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { newShareToken, parseSharedTrip, shareUrlFor } from "./tripShare";

/** get_shared_trip(supabase/sql/023) が返す形。 */
const PAYLOAD = {
  includeExpenses: false,
  trip: {
    name: "台北3日",
    destination: "台北",
    startDate: "2026-10-01",
    endDate: "2026-10-03",
    memo: "パスポートの期限を確認",
    status: "planning",
  },
  schedule: [{ date: "2026-10-01", startTime: "10:00", title: "空港", type: "transport" }],
  packing: [{ title: "充電器", category: "electronics", checked: false }],
  route: [{ name: "九份", address: "新北市瑞芳区", sortOrder: 1, visited: false }],
  expenses: [{ title: "航空券", amount: 48000, category: "transport", paid: true }],
};

describe("newShareToken", () => {
  it("URLに入れられる64文字の合鍵を作る", () => {
    const token = newShareToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("呼ぶたびに違う合鍵になる(使い回さない)", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => newShareToken()));
    expect(tokens.size).toBe(20);
  });
});

describe("shareUrlFor", () => {
  it("共有ページのURLを組み立てる", () => {
    expect(shareUrlFor("abc", "https://example.com")).toBe("https://example.com/share/trip/abc");
  });
});

describe("parseSharedTrip", () => {
  it("旅行の中身をそのまま読む", () => {
    const parsed = parseSharedTrip(PAYLOAD);
    expect(parsed?.trip.name).toBe("台北3日");
    expect(parsed?.trip.memo).toBe("パスポートの期限を確認");
    expect(parsed?.schedule).toHaveLength(1);
    expect(parsed?.packing).toHaveLength(1);
    expect(parsed?.route).toHaveLength(1);
  });

  it("費用を共有しない設定なら、費用は落とす", () => {
    // サーバー側でも空にして返しているが、こちらでも二重に落とす。
    expect(parseSharedTrip(PAYLOAD)?.expenses).toEqual([]);
  });

  it("費用を共有する設定なら、費用も読む", () => {
    const parsed = parseSharedTrip({ ...PAYLOAD, includeExpenses: true });
    expect(parsed?.includeExpenses).toBe(true);
    expect(parsed?.expenses).toHaveLength(1);
  });

  it("共有が終わっている(何も返ってこない)ときは null", () => {
    expect(parseSharedTrip(null)).toBeNull();
  });

  it("旅行そのものが消えているときも null(リンクだけ残っている場合)", () => {
    expect(parseSharedTrip({ ...PAYLOAD, trip: null })).toBeNull();
  });

  it("一覧が入っていなくても空の配列にする", () => {
    const parsed = parseSharedTrip({ includeExpenses: false, trip: PAYLOAD.trip });
    expect(parsed?.schedule).toEqual([]);
    expect(parsed?.packing).toEqual([]);
    expect(parsed?.route).toEqual([]);
    expect(parsed?.expenses).toEqual([]);
  });
});
