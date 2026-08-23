import { describe, expect, it } from "vitest";
import {
  buildComposeUserMessage,
  buildUserMessage,
  formatBusySlots,
  formatCandidateLabel,
  parseModelOutput,
  stripKnownGreetingAndClosing,
} from "../functions/generateDraft";

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

  it("parses [日程制約] as the earliest allowed date when present", () => {
    const text = `[候補日]\n2026-08-20|14:00|15:00\n\n[日程制約]\n2026-08-17\n\n[件名]\n面接日程\n\n[本文]\n本文`;
    const result = parseModelOutput(text);
    expect(result.earliestDate).toBe("2026-08-17");
    expect(result.candidateDates).toEqual([{ date: "2026-08-20", startTime: "14:00", endTime: "15:00" }]);
    expect(result.subject).toBe("面接日程");
  });

  it("returns an empty earliestDate when [日程制約] is omitted (no constraint stated)", () => {
    const result = parseModelOutput("[本文]\n本文のみ");
    expect(result.earliestDate).toBe("");
  });

  it("ignores a malformed [日程制約] value instead of passing it through", () => {
    const text = `[日程制約]\n来週以降\n\n[本文]\n本文`;
    const result = parseModelOutput(text);
    expect(result.earliestDate).toBe("");
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

describe("buildComposeUserMessage", () => {
  it("includes only the sections that are present, in order", () => {
    const text = buildComposeUserMessage({ to: "taro@example.com", userNotes: "来週の打ち合わせのお願いをしたい" });
    expect(text).toBe("宛先: taro@example.com\n\nユーザーからの指示(このメールで伝えたい内容。必ず反映すること):\n来週の打ち合わせのお願いをしたい");
  });

  it("omits sections entirely when their data is absent", () => {
    const text = buildComposeUserMessage({ to: "taro@example.com", userNotes: "本文" });
    expect(text).not.toContain("過去にユーザーが実際に送信したメールの例");
    expect(text).not.toContain("現在の下書き本文");
    expect(text).not.toContain("予定が入っている日時");
  });

  it("includes style examples and the current draft when provided", () => {
    const text = buildComposeUserMessage({
      to: "taro@example.com",
      userNotes: "承諾の返事をしたい",
      styleExamples: ["いつもお世話になっております。"],
      currentDraft: "前回の下書き本文",
    });
    expect(text).toContain("過去にユーザーが実際に送信したメールの例");
    expect(text).toContain("いつもお世話になっております。");
    expect(text).toContain("現在の下書き本文(直前にAIが生成し");
    expect(text).toContain("前回の下書き本文");
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

  // 実際に出た不具合(2026-08-24): お礼の次の行で改めて名乗るため、固定で足す
  // 「お世話になっております。船田です。」と合わせて名乗りが2回続いて見えていた。
  it("removes a second self-introduction that follows a thanks line", () => {
    const result = stripKnownGreetingAndClosing(
      "ご連絡いただきありがとうございます。\n船田です。\n\n履歴書の再提出につきまして、承知いたしました。",
    );
    expect(result).toBe("ご連絡いただきありがとうございます。\n\n履歴書の再提出につきまして、承知いたしました。");
  });

  it("removes a greeting sentence that shares a line with real content, keeping the content", () => {
    const result = stripKnownGreetingAndClosing("お世話になっております。船田です。ご連絡ありがとうございます。");
    expect(result).toBe("ご連絡ありがとうございます。");
  });

  it("removes a company-prefixed self-introduction", () => {
    const result = stripKnownGreetingAndClosing("いつもお世話になっております。\n株式会社サンプルの船田でございます。\n\n承知いたしました。");
    expect(result).toBe("承知いたしました。");
  });

  it("keeps a set phrase that appears mid-sentence as part of the actual message", () => {
    const result = stripKnownGreetingAndClosing("当日はお世話になります。何卒よろしくお願いいたします。");
    expect(result).toBe("当日はお世話になります。何卒よろしくお願いいたします。");
  });

  it("keeps a sentence that merely mentions the name without being a self-introduction", () => {
    const result = stripKnownGreetingAndClosing("採用担当の田中様にお伝えください。");
    expect(result).toBe("採用担当の田中様にお伝えください。");
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
