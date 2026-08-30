import { describe, expect, it } from "vitest";
import type { JobApplication } from "../types";
import { companyAliases, detectJobStageSuggestion, detectStageFromText } from "./jobMailSuggestion";

function application(companyName: string, over: Partial<JobApplication> = {}): JobApplication {
  return { id: companyName, companyName, stage: "applied", createdAt: 0, ...over };
}

function email(over: Partial<Parameters<typeof detectJobStageSuggestion>[0]> = {}) {
  return { from: "採用担当 <saiyo@example.com>", subject: "", snippet: "", ...over };
}

describe("companyAliases", () => {
  it("会社の種類を外した言い方も作る", () => {
    expect(companyAliases("株式会社ABC")).toContain("abc");
    expect(companyAliases("株式会社ABC")).toContain("株式会社abc");
  });

  it("空白は無視する", () => {
    expect(companyAliases("株式会社 ABC 商事")).toContain("abc商事");
  });

  it("1文字しか残らない言い方は使わない(関係ないメールまで拾うため)", () => {
    expect(companyAliases("株式会社A")).toEqual(["株式会社a"]);
  });

  it("名前が空なら何も返さない", () => {
    expect(companyAliases("  ")).toEqual([]);
  });
});

describe("detectStageFromText", () => {
  it("段階を表す言葉を拾う", () => {
    expect(detectStageFromText("一次面接のご案内")).toBe("interview1");
    expect(detectStageFromText("二次面接の日程について")).toBe("interview2");
    expect(detectStageFromText("最終面接のご連絡")).toBe("final");
    expect(detectStageFromText("書類選考の結果")).toBe("document");
    expect(detectStageFromText("内定のご連絡")).toBe("offer");
  });

  it("お見送りは面接の段階より先に読む", () => {
    expect(detectStageFromText("一次面接の結果、今回はお見送りとさせていただきます")).toBe("rejected");
  });

  it("手がかりが無ければ何も返さない", () => {
    expect(detectStageFromText("請求書のご送付")).toBeUndefined();
  });
});

describe("detectJobStageSuggestion", () => {
  it("会社名と段階が両方読めたら提案する", () => {
    const suggestion = detectJobStageSuggestion(
      email({ subject: "【株式会社ABC】一次面接のご案内", snippet: "日程をお知らせください" }),
      [application("株式会社ABC")],
    );
    expect(suggestion?.application.companyName).toBe("株式会社ABC");
    expect(suggestion?.stage).toBe("interview1");
    expect(suggestion?.hint).toBe("一次面接");
  });

  it("差出人にしか会社名が無くても見つける", () => {
    const suggestion = detectJobStageSuggestion(
      email({ from: "ABC商事 採用担当 <saiyo@example.com>", subject: "書類選考の結果について" }),
      [application("株式会社ABC商事")],
    );
    expect(suggestion?.stage).toBe("document");
  });

  it("会社名が出てこないメールでは提案しない", () => {
    expect(detectJobStageSuggestion(email({ subject: "一次面接のご案内" }), [application("株式会社ABC")])).toBeUndefined();
  });

  it("段階が読めないメールでは提案しない", () => {
    expect(
      detectJobStageSuggestion(email({ subject: "株式会社ABCからのお知らせ" }), [application("株式会社ABC")]),
    ).toBeUndefined();
  });

  it("すでにその段階なら提案しない", () => {
    expect(
      detectJobStageSuggestion(email({ subject: "株式会社ABC 一次面接のご案内" }), [
        application("株式会社ABC", { stage: "interview1" }),
      ]),
    ).toBeUndefined();
  });

  it("いまより前の段階へは戻さない", () => {
    expect(
      detectJobStageSuggestion(email({ subject: "株式会社ABC 面接のご案内" }), [
        application("株式会社ABC", { stage: "interview2" }),
      ]),
    ).toBeUndefined();
  });

  it("お見送りと内定は、どこからでも提案する", () => {
    const rejected = detectJobStageSuggestion(
      email({ subject: "株式会社ABC 選考結果", snippet: "誠に残念ながら今回はお見送りとさせていただきます" }),
      [application("株式会社ABC", { stage: "final" })],
    );
    expect(rejected?.stage).toBe("rejected");

    const offer = detectJobStageSuggestion(email({ subject: "株式会社ABC 内定のご連絡" }), [
      application("株式会社ABC", { stage: "document" }),
    ]);
    expect(offer?.stage).toBe("offer");
  });

  it("結果が出ている応募先は蒸し返さない", () => {
    expect(
      detectJobStageSuggestion(email({ subject: "株式会社ABC 一次面接のご案内" }), [
        application("株式会社ABC", { stage: "rejected" }),
      ]),
    ).toBeUndefined();
  });

  it("「あとで」を押したメールには出さない", () => {
    expect(
      detectJobStageSuggestion(
        email({ subject: "株式会社ABC 一次面接のご案内", jobStageSuggestionDismissedAt: 1 }),
        [application("株式会社ABC")],
      ),
    ).toBeUndefined();
  });

  it("会社名が長く一致した応募先を選ぶ", () => {
    const suggestion = detectJobStageSuggestion(email({ subject: "ABC商事 一次面接のご案内" }), [
      application("ABC"),
      application("ABC商事"),
    ]);
    expect(suggestion?.application.companyName).toBe("ABC商事");
  });

  it("記録が1件も無ければ提案しない", () => {
    expect(detectJobStageSuggestion(email({ subject: "株式会社ABC 内定のご連絡" }), [])).toBeUndefined();
  });
});
