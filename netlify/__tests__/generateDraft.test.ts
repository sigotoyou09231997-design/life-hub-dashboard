import { describe, expect, it } from "vitest";
import { buildUserMessage, formatBusySlots, formatCandidateLabel, parseModelOutput, stripKnownGreetingAndClosing } from "../functions/generateDraft";

describe("parseModelOutput", () => {
  it("splits the [ポイント]/[本文] sections and strips bullet markers", () => {
    const text = `[ポイント]\n- 面接日程を2件提案する\n- お礼の言葉を入れる\n\n[本文]\nこの度は面接のご案内をいただき、ありがとうございます。`;
    const result = parseModelOutput(text);
    expect(result.keyPoints).toEqual(["面接日程を2件提案する", "お礼の言葉を入れる"]);
    expect(result.candidateDates).toEqual([]);
    expect(result.body).toBe("この度は面接のご案内をいただき、ありがとうございます。");
  });

  it("falls back to treating the whole response as the body when the model skips the format", () => {
    const result = parseModelOutput("ただの返信文だけが返ってきた場合");
    expect(result.keyPoints).toEqual([]);
    expect(result.candidateDates).toEqual([]);
    expect(result.body).toBe("ただの返信文だけが返ってきた場合");
  });

  it("handles a missing [ポイント] section but a present [本文] section", () => {
    const result = parseModelOutput("[本文]\n本文のみ");
    expect(result.keyPoints).toEqual([]);
    expect(result.body).toBe("本文のみ");
  });

  it("parses the [候補日] section into structured dates, ignoring malformed lines", () => {
    const text = `[ポイント]\n- 候補日を2件提案する\n\n[候補日]\n2026-08-20|14:00|15:00\n2026-08-21||\nnot-a-date|foo\n\n[本文]\n8/20(木) 14:00〜15:00、8/21(金)でご都合いかがでしょうか。`;
    const result = parseModelOutput(text);
    expect(result.candidateDates).toEqual([
      { date: "2026-08-20", startTime: "14:00", endTime: "15:00" },
      { date: "2026-08-21", startTime: undefined, endTime: undefined },
    ]);
    expect(result.body).toBe("8/20(木) 14:00〜15:00、8/21(金)でご都合いかがでしょうか。");
  });

  it("returns no candidate dates when [候補日] is omitted (no scheduling proposed)", () => {
    const result = parseModelOutput("[ポイント]\n- お礼を伝える\n\n[本文]\nありがとうございます。");
    expect(result.candidateDates).toEqual([]);
  });

  it("parses the [件名] section as a single trimmed line, ahead of [本文]", () => {
    const text = `[ポイント]\n- お礼を伝える\n\n[件名]\nご案内のお礼\n\n[本文]\nありがとうございます。`;
    const result = parseModelOutput(text);
    expect(result.subject).toBe("ご案内のお礼");
    expect(result.body).toBe("ありがとうございます。");
  });

  it("parses [件名] correctly even when [候補日] is also present", () => {
    const text = `[ポイント]\n- 日程を提案する\n\n[候補日]\n2026-08-20|14:00|15:00\n\n[件名]\n面接日程のご案内\n\n[本文]\n8/20(木) 14:00〜15:00でいかがでしょうか。`;
    const result = parseModelOutput(text);
    expect(result.subject).toBe("面接日程のご案内");
    expect(result.candidateDates).toEqual([{ date: "2026-08-20", startTime: "14:00", endTime: "15:00" }]);
  });

  it("returns an empty subject when [件名] is omitted", () => {
    const result = parseModelOutput("[本文]\n本文のみ");
    expect(result.subject).toBe("");
  });
});

describe("buildUserMessage", () => {
  const basePayload = { from: "a@example.com", subject: "件名", body: "本文" };

  it("omits the user-notes section entirely when userNotes is absent or blank", () => {
    expect(buildUserMessage(basePayload)).not.toContain("ユーザーからの追加指示");
    expect(buildUserMessage({ ...basePayload, userNotes: "   " })).not.toContain("ユーザーからの追加指示");
  });

  it("appends a labeled, trimmed user-notes section when present", () => {
    const text = buildUserMessage({ ...basePayload, userNotes: "  火曜以外で調整したい  " });
    expect(text).toContain("ユーザーからの追加指示(必ず反映すること):\n火曜以外で調整したい");
  });
});

describe("formatCandidateLabel", () => {
  it('formats a date+time range as "M/D(曜) HH:mm〜HH:mm"', () => {
    expect(formatCandidateLabel({ date: "2026-08-20", startTime: "14:00", endTime: "15:00" })).toBe("8/20(木) 14:00〜15:00");
  });

  it("formats a date with only a start time", () => {
    expect(formatCandidateLabel({ date: "2026-08-20", startTime: "14:00" })).toBe("8/20(木) 14:00〜");
  });

  it("formats a date with no time as just the date+weekday", () => {
    expect(formatCandidateLabel({ date: "2026-08-20" })).toBe("8/20(木)");
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
