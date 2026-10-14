import { describe, expect, it } from "vitest";
import { answerLines, seenKey } from "../feedback-watch.mjs";

describe("seenKey(見たかどうかの鍵)", () => {
  it("答えのある依頼は、答えの時刻を付けて、前に流した依頼とは別の新しいものとして数える", () => {
    expect(seenKey({ id: "a" })).toBe("a");
    expect(seenKey({ id: "a", answer: "はい", answeredAt: "2026-10-14T10:00:00Z" })).toBe("a@2026-10-14T10:00:00Z");
    // もう一度質問して、答え直した時は、また別の鍵(また流れる)。
    expect(seenKey({ id: "a", answeredAt: "2026-10-14T11:00:00Z" })).not.toBe(seenKey({ id: "a", answeredAt: "2026-10-14T10:00:00Z" }));
  });
});

describe("answerLines(質問への回答が届いた知らせ)", () => {
  const item = {
    id: "abc",
    message: "ルートは日程の横がいい",
    statusNote: "どの横ですか?",
    questionOptions: ["PCで左右に並べる", "スマホでも日程の下に出す"],
    answer: "PCで左右に並べる",
    answeredAt: "2026-10-14T10:00:00Z",
    page: "/trips/x",
  };

  it("元の依頼・質問・選択肢・押された答えを、データの区切りの中に出す。見出しに id と「質問への回答が届いた」", () => {
    const text = answerLines(item).join("\n");
    expect(text).toContain("【質問への回答が届いた】 id=abc");
    expect(text).toContain("<<<");
    expect(text).toContain("│ 依頼: ルートは日程の横がいい");
    expect(text).toContain("│ 質問: どの横ですか?");
    expect(text).toContain("│ 選択肢: PCで左右に並べる / スマホでも日程の下に出す");
    expect(text).toContain("│ 答え: PCで左右に並べる");
    expect(text).toContain(">>>ここまで");
  });

  it("長すぎる文章・制御文字は切る(会話が埋まらないように)", () => {
    const long = answerLines({ ...item, message: "あ".repeat(5000) }).join("\n");
    expect(long).toContain("以降は省略");
    expect(answerLines({ ...item, answer: "A\u0007B" }).join("\n")).toContain("答え: AB");
  });
});
