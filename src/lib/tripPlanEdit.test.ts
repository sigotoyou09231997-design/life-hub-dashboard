import { describe, expect, it } from "vitest";
import type { TripScheduleItem } from "../types";
import type { TripImportRow } from "./mailPlanImport";
import { describeScanSaved, diffAgainstSchedule, hasPrefecture, matchRowsToSchedule, unmentionedSchedule } from "./tripPlanEdit";

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

  it("2文字の短い題名は、含むだけでは同じとみなさない", () => {
    const matches = matchRowsToSchedule([row({ title: "移動中に昼食" })], [item({ id: "a", title: "昼食" })]);
    expect(matches).toEqual([undefined]);
  });

  it("2文字の題名でも、開始時刻まで同じなら同じ予定(読み直しで「屋島観光」が「屋島」に変わる)", () => {
    // 時刻も合う時まで見逃すと、読み直すたびに同じ予定が二重に入る。
    const [match] = matchRowsToSchedule(
      [row({ title: "屋島", startTime: "16:40" })],
      [item({ id: "a", title: "屋島観光", startTime: "16:40", endTime: "17:20" })],
    );
    expect(match?.item.id).toBe("a");
    expect(match?.strength).toBe("strong");
    // 時刻が違えば、2文字の題名では当てない。
    expect(matchRowsToSchedule([row({ title: "屋島", startTime: "09:00" })], [item({ id: "a", title: "屋島観光", startTime: "16:40" })])).toEqual([undefined]);
  });

  it("矢印だけが同じ「羽田→福岡」と「羽田→大阪」は、確かな一致にしない(同じ時刻・同じ種類の枠として弱く当てる)", () => {
    // 1人の旅で同じ分に2便は出ないので、行き先が変わった同じ便の枠とみなす。ただし既定では選ばない。
    const matches = matchRowsToSchedule(
      [row({ title: "羽田→大阪", startTime: "08:20" })],
      [item({ id: "a", title: "羽田→福岡", startTime: "08:20" })],
    );
    expect(matches[0]).toMatchObject({ strength: "loose", bySlot: true });
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

describe("地域つきに直した場所を、計画文の名前で書き戻さない", () => {
  // 地図が別の場所を選ばないよう「霊山寺 徳島県鳴門市大麻町」のように直した後で、元の計画文を貼り直す場面。
  it("いまの場所に都道府県があり、文章の方に無ければ、場所は直さない", () => {
    const now = item({ id: "a", title: "高松→大麻比古神社", startTime: "12:10", location: "ニコニコレンタカー高松県庁前店 香川県高松市" });
    const { changes } = diffAgainstSchedule(now, row({ title: "高松→大麻比古神社", startTime: "12:10", location: "高松市内" }));
    expect(changes).toEqual([]);
  });

  it("名前だけの場所に、文章が都道府県を足していれば直す", () => {
    const now = item({ id: "a", title: "霊山寺", startTime: "13:30", location: "霊山寺" });
    const { changes } = diffAgainstSchedule(now, row({ title: "霊山寺", startTime: "13:30", location: "霊山寺 徳島県鳴門市" }));
    expect(changes).toEqual([{ field: "location", label: "場所", before: "霊山寺", after: "霊山寺 徳島県鳴門市" }]);
  });

  it("どちらにも都道府県があって違えば、これまでどおり直す", () => {
    const now = item({ id: "a", title: "宿", location: "JRクレメントイン高知 高知県高知市" });
    const { changes } = diffAgainstSchedule(now, row({ title: "宿", location: "ダイワロイネットホテル高知 高知県高知市" }));
    expect(changes.map((c) => c.field)).toEqual(["location"]);
  });

  it("都道府県の見分け(「道の駅」や「京都駅」の字を都道府県と取り違えない)", () => {
    expect(hasPrefecture("霊山寺 徳島県鳴門市大麻町")).toBe(true);
    expect(hasPrefecture("東京駅 東京都千代田区")).toBe(true);
    expect(hasPrefecture("北海道函館市")).toBe(true);
    expect(hasPrefecture("道の駅 くるくるなると")).toBe(false);
    expect(hasPrefecture("京都駅")).toBe(false);
    expect(hasPrefecture("東京駅")).toBe(false);
  });
});

describe("足りない予定を、似た題名の既存の予定の更新にしない", () => {
  it("同じ時刻でも、場所が別の所なら確かな一致にしない(既定で選ばれて松山城を書き換えない)", () => {
    const castle = item({ id: "c", title: "松山城", date: "2026-12-29", startTime: "15:00", type: "sightseeing", location: "松山城 愛媛県松山市丸之内" });
    const [match] = matchRowsToSchedule(
      [row({ title: "松山城山ロープウェイ", date: "2026-12-29", startTime: "15:00", type: "sightseeing", location: "松山城山ロープウェイ" })],
      [castle],
    );
    expect(match?.strength).toBe("loose");
  });

  it("同じ文章に「松山城」の行もあれば、松山城はそちらが取り、ロープウェイは新しい予定になる", () => {
    const castle = item({ id: "c", title: "松山城", date: "2026-12-29", startTime: "15:00", type: "sightseeing", location: "松山城" });
    const matches = matchRowsToSchedule(
      [
        row({ title: "松山城山ロープウェイ", date: "2026-12-29", startTime: "15:00", type: "sightseeing", location: "松山城山ロープウェイ" }),
        row({ title: "松山城", date: "2026-12-29", startTime: "15:00", type: "sightseeing", location: "松山城" }),
      ],
      [castle],
    );
    expect(matches[0]).toBeUndefined();
    expect(matches[1]?.item.id).toBe("c");
  });

  it("場所が同じ所(都道府県を足しただけ)なら、これまでどおり当てる", () => {
    const yashima = item({ id: "y", title: "屋島観光", date: "2026-12-30", startTime: "17:05", location: "屋島 香川県" });
    const [match] = matchRowsToSchedule([row({ title: "屋島", date: "2026-12-30", startTime: "17:05", location: "屋島" })], [yashima]);
    expect(match?.item.id).toBe("y");
  });
});

describe("組み直した計画との突き合わせ(ChatGPTで作り直すと、順番も書き方も変わる)", () => {
  it("順番が入れ替わった予定は、題名で当てて時刻を更新する(二重に入れない)", () => {
    const existing = [
      item({ id: "o", title: "大麻比古神社", startTime: "13:15", endTime: "13:30", type: "sightseeing" }),
      item({ id: "r", title: "霊山寺", startTime: "13:30", endTime: "13:45", type: "sightseeing" }),
    ];
    const rows = [
      row({ title: "霊山寺参拝", startTime: "13:15", endTime: "13:30", type: "sightseeing" }),
      row({ title: "大麻比古神社参拝", startTime: "13:45", endTime: "14:00", type: "sightseeing" }),
    ];
    const matches = matchRowsToSchedule(rows, existing);
    expect(matches.map((m) => [m?.item.id, m?.strength])).toEqual([
      ["r", "strong"],
      ["o", "strong"],
    ]);
  });

  it("種類が違えば、時刻がずれた同じ名前でも当てない(「高知城」と「高知城へ移動」)", () => {
    const [match] = matchRowsToSchedule(
      [row({ title: "高知城へ移動", startTime: "17:00", type: "transport" })],
      [item({ id: "k", title: "高知城", startTime: "17:10", type: "sightseeing" })],
    );
    expect(match).toBeUndefined();
  });

  it("書き方がまるで違っても、開始・終了の時刻と種類が同じなら同じ枠として当てる", () => {
    const existing = [
      item({ id: "rent", title: "レンタカー出発", startTime: "12:10", type: "transport" }),
      item({ id: "leg", title: "高松→大麻比古神社", startTime: "12:10", endTime: "13:15", type: "transport" }),
    ];
    const [match] = matchRowsToSchedule([row({ title: "霊山寺へ移動", startTime: "12:10", endTime: "13:15", type: "transport" })], existing);
    // 終了時刻まで合う方を取る。弱い一致なので、既定では選ばない(更新しなければ二重にも入らない)。
    expect(match).toMatchObject({ item: { id: "leg" }, strength: "loose", bySlot: true });
  });

  it("枠で当てた時だけ、題名の書き換えも更新の候補にする", () => {
    const leg = item({ id: "leg", title: "高松→大麻比古神社", startTime: "12:10", endTime: "13:15", type: "transport" });
    const next = row({ title: "霊山寺へ移動", startTime: "12:10", endTime: "13:15", type: "transport" });
    expect(diffAgainstSchedule(leg, next).changes).toEqual([]);
    expect(diffAgainstSchedule(leg, next, { allowRename: true }).changes).toEqual([
      { field: "title", label: "題名", before: "高松→大麻比古神社", after: "霊山寺へ移動" },
    ]);
  });
});

describe("文章に無い予定", () => {
  const existing = [
    item({ id: "a", title: "霊山寺", date: "2026-12-27", startTime: "13:30" }),
    item({ id: "b", title: "霊山寺→鳴門観光汽船", date: "2026-12-27", startTime: "13:45" }),
    item({ id: "c", title: "うだつの町並み", date: "2026-12-28", startTime: "07:45" }),
    item({ id: "d", title: "松山城", date: "2026-12-29", startTime: "15:00" }),
  ];

  it("文章が扱っている日のうち、どの行にも当たらなかった日程だけを出す(他の日は見ない)", () => {
    const rows = [
      { date: "2026-12-27", matchId: "a" },
      { date: "2026-12-28", sameAsId: "c" },
    ];
    expect(unmentionedSchedule(existing, rows).map((i) => i.id)).toEqual(["b"]);
  });

  it("読み取った行が無ければ、何も出さない", () => {
    expect(unmentionedSchedule(existing, [])).toEqual([]);
  });

  it("消した数も知らせる", () => {
    expect(describeScanSaved(2, 1, 0, 3)).toBe("日程に2件入れ、日程を1件更新し、3件消しました");
    expect(describeScanSaved(0, 0, 0, 2)).toBe("日程を2件消しました");
    expect(describeScanSaved(1, 0, 0, 1)).toBe("日程に1件入れ、1件消しました");
  });
});

