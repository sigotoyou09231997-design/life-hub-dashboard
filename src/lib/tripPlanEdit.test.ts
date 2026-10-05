import { describe, expect, it } from "vitest";
import type { TripScheduleItem } from "../types";
import type { TripImportRow } from "./mailPlanImport";
import { describeScanSaved, diffAgainstSchedule, matchRowsToSchedule } from "./tripPlanEdit";

function item(partial: Partial<TripScheduleItem> & { id: string; title: string }): TripScheduleItem {
  return { tripId: "trip-1", date: "2026-09-12", type: "other", createdAt: 0, ...partial };
}

function row(partial: Partial<TripImportRow> & { title: string }): TripImportRow {
  return { date: "2026-09-12", type: "other", checked: true, withExpense: false, ...partial };
}

describe("読み取った行と既存の日程の突き合わせ", () => {
  it("日付・時刻・題名が同じなら、確かな一致", () => {
    const [match] = matchRowsToSchedule(
      [row({ title: "羽田→福岡", startTime: "08:20" })],
      [item({ id: "a", title: "羽田→福岡", startTime: "08:20" })],
    );
    expect(match?.item.id).toBe("a");
    expect(match?.strength).toBe("strong");
  });

  it("題名が同じなら、時刻が変わっていても同じ予定(出発が10時から11時に変わった)", () => {
    const [match] = matchRowsToSchedule(
      [row({ title: "レンタカー受取", startTime: "11:00" })],
      [item({ id: "a", title: "レンタカー受取", startTime: "10:00" })],
    );
    expect(match?.item.id).toBe("a");
    expect(match?.strength).toBe("strong");
  });

  it("絵文字や記号の違いは同じ題名として見る", () => {
    const [match] = matchRowsToSchedule([row({ title: "初心者船釣り" })], [item({ id: "a", title: "🎣 初心者船釣り" })]);
    expect(match?.strength).toBe("strong");
  });

  it("日が違えば別の予定(毎日出てくる「ホテル泊」を取り違えない)", () => {
    const matches = matchRowsToSchedule(
      [row({ title: "ホテル泊", date: "2026-09-13" })],
      [item({ id: "a", title: "ホテル泊", date: "2026-09-12" })],
    );
    expect(matches).toEqual([undefined]);
  });

  it("片方がもう片方を含むだけの一致は、弱い一致", () => {
    const [match] = matchRowsToSchedule(
      [row({ title: "お迎え・買い出し・鎌倉散歩" })],
      [item({ id: "a", title: "鎌倉散歩" })],
    );
    expect(match?.item.id).toBe("a");
    expect(match?.strength).toBe("loose");
  });

  it("含むだけでも、時刻が合っていれば確かな一致", () => {
    const [match] = matchRowsToSchedule(
      [row({ title: "土庄→高松 フェリー", startTime: "17:50" })],
      [item({ id: "a", title: "フェリー", startTime: "17:50" })],
    );
    expect(match?.strength).toBe("strong");
  });

  it("題名の書き方が違い、時刻も食い違うものは別の予定", () => {
    const matches = matchRowsToSchedule(
      [row({ title: "鎌倉散歩とお昼", startTime: "13:00" })],
      [item({ id: "a", title: "鎌倉散歩", startTime: "10:00" })],
    );
    expect(matches).toEqual([undefined]);
  });

  it("2文字以下の短い題名は、含むだけでは同じとみなさない", () => {
    const matches = matchRowsToSchedule([row({ title: "移動中に昼食" })], [item({ id: "a", title: "昼食" })]);
    expect(matches).toEqual([undefined]);
  });

  it("矢印だけが同じ「羽田→福岡」と「羽田→大阪」は別の予定", () => {
    const matches = matchRowsToSchedule(
      [row({ title: "羽田→大阪", startTime: "08:20" })],
      [item({ id: "a", title: "羽田→福岡", startTime: "08:20" })],
    );
    expect(matches).toEqual([undefined]);
  });

  it("既存の日程1件に当てられる行は1行だけ(2行が同じ日程を書き換えない)", () => {
    // 同じ日程に2行が当たると、後の行が前の行の更新を黙って上書きしてしまう。
    const matches = matchRowsToSchedule(
      [row({ title: "昼食", startTime: "12:00" }), row({ title: "昼食", startTime: "18:00" })],
      [item({ id: "a", title: "昼食", startTime: "12:00" })],
    );
    expect(matches[0]?.item.id).toBe("a");
    // 18:00 の行は当て先が無いので、新しい予定。
    expect(matches[1]).toBeUndefined();
  });

  it("同じ題名が1日に2つある時は、時刻が近い方に当てる", () => {
    const matches = matchRowsToSchedule(
      [row({ title: "休憩", startTime: "15:30" })],
      [item({ id: "morning", title: "休憩", startTime: "10:00" }), item({ id: "afternoon", title: "休憩", startTime: "15:00" })],
    );
    expect(matches[0]?.item.id).toBe("afternoon");
  });

  it("点数の高い組から決める(早い行の弱い一致が、後ろの行の確かな一致を横取りしない)", () => {
    const matches = matchRowsToSchedule(
      [row({ title: "お迎え・買い出し・鎌倉散歩" }), row({ title: "鎌倉散歩" })],
      [item({ id: "a", title: "鎌倉散歩" })],
    );
    expect(matches[0]).toBeUndefined();
    expect(matches[1]?.item.id).toBe("a");
    expect(matches[1]?.strength).toBe("strong");
  });

  it("id の無い日程は更新先にしない", () => {
    const noId = { tripId: "trip-1", date: "2026-09-12", type: "other", title: "鎌倉散歩", createdAt: 0 } as TripScheduleItem;
    expect(matchRowsToSchedule([row({ title: "鎌倉散歩" })], [noId])).toEqual([undefined]);
  });

  it("日程がまだ読み込めていない時は、何にも当てない", () => {
    expect(matchRowsToSchedule([row({ title: "鎌倉散歩" })], undefined)).toEqual([undefined]);
  });
});

describe("更新で何が変わるか", () => {
  const base = item({ id: "a", title: "レンタカー受取", startTime: "10:00" });

  it("時刻が変わった所だけを出す", () => {
    const { patch, changes } = diffAgainstSchedule(base, row({ title: "レンタカー受取", startTime: "11:00" }));
    expect(patch).toEqual({ startTime: "11:00" });
    expect(changes).toEqual([{ field: "startTime", label: "開始", before: "10:00", after: "11:00" }]);
  });

  it("後から分かった場所と終了時刻を足す(いまが空の項目は「なし」から)", () => {
    const { patch, changes } = diffAgainstSchedule(
      base,
      row({ title: "レンタカー受取", startTime: "10:00", endTime: "10:30", location: "小豆島 土庄港" }),
    );
    expect(patch).toEqual({ endTime: "10:30", location: "小豆島 土庄港" });
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ["終了", undefined, "10:30"],
      ["場所", undefined, "小豆島 土庄港"],
    ]);
  });

  it("文章に書かれていない項目は、いまの値を空にしない", () => {
    const rich = item({ id: "a", title: "ホテル", startTime: "15:00", endTime: "16:00", location: "函館駅前", memo: "朝食付き" });
    const { patch, changes } = diffAgainstSchedule(rich, row({ title: "ホテル" }));
    expect(patch).toEqual({});
    expect(changes).toEqual([]);
  });

  it("いまの方が詳しい場所は、短い書き方で上書きしない", () => {
    const { patch } = diffAgainstSchedule(
      item({ id: "a", title: "散歩", location: "鎌倉駅 西口" }),
      row({ title: "散歩", location: "鎌倉駅" }),
    );
    expect(patch).toEqual({});
  });

  it("読み取った題名が詳しい時だけ題名を直す(言い換えは直さない)", () => {
    const detailed = diffAgainstSchedule(item({ id: "a", title: "鎌倉散歩" }), row({ title: "お迎え・買い出し・鎌倉散歩" }));
    expect(detailed.patch).toEqual({ title: "お迎え・買い出し・鎌倉散歩" });
    const reworded = diffAgainstSchedule(
      item({ id: "a", title: "フェリー乗船", startTime: "17:50" }),
      row({ title: "土庄→高松 フェリー", startTime: "17:50" }),
    );
    expect(reworded.patch).toEqual({});
    // 読み取りの方が短い時も、いまの題名を残す。
    const shorter = diffAgainstSchedule(item({ id: "a", title: "お迎え・買い出し・鎌倉散歩" }), row({ title: "鎌倉散歩" }));
    expect(shorter.patch).toEqual({});
  });

  it("種類は「その他」の時だけ、メモは空の時だけ埋める(本人が決めた・書いたものは上書きしない)", () => {
    const filled = diffAgainstSchedule(
      item({ id: "a", title: "鎌倉散歩", type: "other" }),
      row({ title: "鎌倉散歩", type: "sightseeing", memo: "雨なら中止" }),
    );
    expect(filled.patch).toEqual({ type: "sightseeing", memo: "雨なら中止" });

    const kept = diffAgainstSchedule(
      item({ id: "a", title: "鎌倉散歩", type: "meal", memo: "自分のメモ" }),
      row({ title: "鎌倉散歩", type: "sightseeing", memo: "雨なら中止" }),
    );
    expect(kept.patch).toEqual({});
  });

  it("全く同じなら、変わる所は無い", () => {
    const { patch, changes } = diffAgainstSchedule(base, row({ title: "レンタカー受取", startTime: "10:00" }));
    expect(patch).toEqual({});
    expect(changes).toEqual([]);
  });
});

describe("入れ終わった知らせ", () => {
  it("追加だけの時は、これまでと同じ文言", () => {
    expect(describeScanSaved(3, 0, 0)).toBe("日程に3件入れました");
    expect(describeScanSaved(1, 0, 1)).toBe("日程に1件、費用に1件入れました");
  });

  it("更新が混ざる時は、更新の件数も書く", () => {
    expect(describeScanSaved(2, 1, 0)).toBe("日程に2件入れ、日程を1件更新しました");
    expect(describeScanSaved(0, 3, 0)).toBe("日程を3件更新しました");
    expect(describeScanSaved(1, 1, 1)).toBe("日程に1件、費用に1件入れ、日程を1件更新しました");
  });
});
