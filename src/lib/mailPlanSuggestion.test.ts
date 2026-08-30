import { describe, expect, it } from "vitest";
import type { EmailStatus } from "../types";
import {
  detectPlanSignals,
  hasPlanKeyword,
  isPlanSuggestion,
  pickPlanSuggestions,
  planSuggestionHint,
} from "./mailPlanSuggestion";

function mail(subject: string, snippet = "", over: { status?: EmailStatus; planSuggestionDismissedAt?: number } = {}) {
  return { subject, snippet, status: "unprocessed" as EmailStatus, ...over };
}

describe("detectPlanSignals", () => {
  it("日本語の日付を見つける", () => {
    expect(detectPlanSignals("9月3日にお越しください").hasDate).toBe(true);
    expect(detectPlanSignals("2026/9/3 開催").hasDate).toBe(true);
    expect(detectPlanSignals("9/3 でお願いします").hasDate).toBe(true);
  });

  it("時刻を見つける(コロンでも「時」でも)", () => {
    expect(detectPlanSignals("14:00 開始").hasTime).toBe(true);
    expect(detectPlanSignals("14時30分から").hasTime).toBe(true);
    expect(detectPlanSignals("14時").hasTime).toBe(true);
  });

  it("日付も時刻も無ければ、どちらも false", () => {
    const signals = detectPlanSignals("ご請求書を送付いたします");
    expect(signals.hasDate).toBe(false);
    expect(signals.hasTime).toBe(false);
    expect(signals.hints).toEqual([]);
  });

  it("見つけた手がかりを、日付・時刻・言葉の順に並べる", () => {
    expect(detectPlanSignals("一次面接のご案内 9月3日(水) 14:00").hints).toEqual(["9月3日", "14:00", "面接"]);
  });

  it("間に空白が入っていても読む", () => {
    expect(detectPlanSignals("9 月 3 日 14 : 00").hints).toEqual(["9月3日", "14:00"]);
  });
});

describe("hasPlanKeyword", () => {
  it("予定になりやすい言葉に反応する", () => {
    expect(hasPlanKeyword("二次面接のご案内")).toBe(true);
    expect(hasPlanKeyword("ご予約が確定しました")).toBe(true);
  });

  it("関係の無い文には反応しない", () => {
    expect(hasPlanKeyword("メールマガジンの配信停止について")).toBe(false);
  });
});

describe("isPlanSuggestion", () => {
  it("日付と時刻が揃っていれば提案する", () => {
    expect(isPlanSuggestion(mail("ご連絡", "9月3日 14:00 にお願いします"))).toBe(true);
  });

  it("日付と、予定らしい言葉でも提案する(時刻が無くても)", () => {
    expect(isPlanSuggestion(mail("一次面接のご案内", "9月3日にお越しください"))).toBe(true);
  });

  it("日付が無ければ提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "日程は追ってご連絡します"))).toBe(false);
  });

  it("日付だけで、時刻も予定らしい言葉も無ければ提案しない", () => {
    // 請求書やお知らせを毎回拾わないための線引き。
    expect(isPlanSuggestion(mail("ご請求書の送付", "お支払期限は9月30日です"))).toBe(false);
  });

  it("件名と抜粋にまたがっていても拾う", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日にお越しください"))).toBe(true);
  });

  it("返信を送り終えたメールは提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { status: "sent" }))).toBe(false);
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { status: "skipped" }))).toBe(false);
  });

  it("「あとで」を押したメールは、もう提案しない", () => {
    expect(isPlanSuggestion(mail("面接のご案内", "9月3日 14:00", { planSuggestionDismissedAt: 1 }))).toBe(false);
  });
});

describe("planSuggestionHint", () => {
  it("見つけたものを中黒でつなぐ", () => {
    expect(planSuggestionHint({ subject: "二次面接のご案内", snippet: "9月3日(水) 14:00 当社会議室" })).toBe(
      "9月3日・14:00・面接",
    );
  });

  it("何も見つからなければ空", () => {
    expect(planSuggestionHint({ subject: "お知らせ", snippet: "" })).toBe("");
  });
});

describe("pickPlanSuggestions", () => {
  it("提案できるものだけを残す(並びは変えない)", () => {
    const emails = [
      mail("面接のご案内", "9月3日 14:00"),
      mail("メールマガジン", "今週のおすすめ"),
      mail("ご予約確定", "9/10 にお待ちしております"),
    ];
    expect(pickPlanSuggestions(emails).map((email) => email.subject)).toEqual(["面接のご案内", "ご予約確定"]);
  });

  it("1件も無ければ空の配列", () => {
    expect(pickPlanSuggestions([mail("お知らせ", "内容")])).toEqual([]);
  });
});
