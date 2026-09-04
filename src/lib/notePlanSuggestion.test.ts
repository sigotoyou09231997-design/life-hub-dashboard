import { describe, expect, it } from "vitest";
import { detectNotePlan, parseTimeText } from "./notePlanSuggestion";

/** 2026-08-27(木)を「今日」として判定する。 */
const TODAY = "2026-08-27";
const BASE = new Date(2026, 7, 27, 12, 0, 0);

function detect(body: string) {
  return detectNotePlan(body, TODAY, BASE);
}

describe("parseTimeText", () => {
  it("コロン区切り・時分・半をどれも HH:mm にする", () => {
    expect(parseTimeText("14:00")).toBe("14:00");
    expect(parseTimeText("9時30分")).toBe("09:30");
    expect(parseTimeText("10時半")).toBe("10:30");
    expect(parseTimeText("14時")).toBe("14:00");
  });

  it("午前・午後を24時制に直す", () => {
    expect(parseTimeText("午後2時")).toBe("14:00");
    expect(parseTimeText("午後12時")).toBe("12:00");
    expect(parseTimeText("午前12時")).toBe("00:00");
    expect(parseTimeText("午前9時")).toBe("09:00");
  });

  it("全角の数字も読む", () => {
    expect(parseTimeText("１４：３０")).toBe("14:30");
  });

  it("時刻でないものは読まない", () => {
    expect(parseTimeText("1時間かかる")).toBeUndefined();
    expect(parseTimeText("打ち合わせ")).toBeUndefined();
    expect(parseTimeText("25時")).toBeUndefined();
  });
});

describe("detectNotePlan", () => {
  it("日付と時刻が揃っていれば候補にする", () => {
    const plan = detect("9月3日 14:00 から打ち合わせ");
    expect(plan?.date).toBe("2026-09-03");
    expect(plan?.time).toBe("14:00");
  });

  it("時刻が無くても、予定らしい言葉があれば終日の候補にする", () => {
    const plan = detect("9月3日は歯医者の予約");
    expect(plan?.date).toBe("2026-09-03");
    expect(plan?.time).toBeUndefined();
  });

  it("日付だけのメモは候補にしない(買った物の記録などに反応させない)", () => {
    expect(detect("9月3日 牛乳 198円")).toBeNull();
  });

  it("日付がまったく無ければ候補にしない", () => {
    expect(detect("牛乳を買う")).toBeNull();
    expect(detect("")).toBeNull();
  });

  it("過ぎた日付は候補にしない", () => {
    expect(detect("8月1日 14:00 打ち合わせ")).toBeNull();
  });

  it("日付が並んでいたら、まだ来ていない中でいちばん早い日を採る", () => {
    const plan = detect("候補: 8月1日 / 9月3日 / 9月10日 いずれも14:00で面談");
    expect(plan?.date).toBe("2026-09-03");
  });

  it("「明日」のような書き方も実際の日に直す", () => {
    const plan = detect("明日15:00に面談");
    expect(plan?.date).toBe("2026-08-28");
    expect(plan?.time).toBe("15:00");
  });

  it("見つけた手がかりを一言にまとめる", () => {
    expect(detect("9月3日 14:00 面接")?.hint).toContain("9月3日");
    expect(detect("9月3日 14:00 面接")?.hint).toContain("面接");
  });
});
