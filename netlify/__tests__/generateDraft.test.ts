import { describe, expect, it } from "vitest";
import { formatBusySlots, parseModelOutput, stripKnownGreetingAndClosing } from "../functions/generateDraft";

describe("parseModelOutput", () => {
  it("splits the [ポイント]/[本文] sections and strips bullet markers", () => {
    const text = `[ポイント]\n- 面接日程を2件提案する\n- お礼の言葉を入れる\n\n[本文]\nこの度は面接のご案内をいただき、ありがとうございます。`;
    const result = parseModelOutput(text);
    expect(result.keyPoints).toEqual(["面接日程を2件提案する", "お礼の言葉を入れる"]);
    expect(result.body).toBe("この度は面接のご案内をいただき、ありがとうございます。");
  });

  it("falls back to treating the whole response as the body when the model skips the format", () => {
    const result = parseModelOutput("ただの返信文だけが返ってきた場合");
    expect(result.keyPoints).toEqual([]);
    expect(result.body).toBe("ただの返信文だけが返ってきた場合");
  });

  it("handles a missing [ポイント] section but a present [本文] section", () => {
    const result = parseModelOutput("[本文]\n本文のみ");
    expect(result.keyPoints).toEqual([]);
    expect(result.body).toBe("本文のみ");
  });
});

describe("stripKnownGreetingAndClosing", () => {
  it("removes a leading greeting+self-introduction the model echoed despite instructions", () => {
    const result = stripKnownGreetingAndClosing("お世話になっております。\n船田です。\n\nご連絡ありがとうございます。");
    expect(result).toBe("ご連絡ありがとうございます。");
  });

  it("removes a trailing closing line", () => {
    const result = stripKnownGreetingAndClosing("承知いたしました。\n\n以上、よろしくお願いいたします。");
    expect(result).toBe("承知いたしました。");
  });

  it("leaves body text untouched when there's no greeting/closing to strip", () => {
    const result = stripKnownGreetingAndClosing("承知いたしました。日程はご相談させてください。");
    expect(result).toBe("承知いたしました。日程はご相談させてください。");
  });
});

describe("formatBusySlots", () => {
  it("returns a placeholder when there are no busy slots", () => {
    expect(formatBusySlots(undefined)).toBe("(予定なし)");
    expect(formatBusySlots([])).toBe("(予定なし)");
  });

  it("formats all-day, timed, and open-ended slots", () => {
    const text = formatBusySlots([
      { date: "2026-08-20", allDay: true },
      { date: "2026-08-21", startTime: "10:00", endTime: "11:00" },
      { date: "2026-08-22", startTime: "14:00" },
      { date: "2026-08-23" },
    ]);
    expect(text).toBe("2026-08-20 終日\n2026-08-21 10:00-11:00\n2026-08-22 14:00〜\n2026-08-23");
  });
});
