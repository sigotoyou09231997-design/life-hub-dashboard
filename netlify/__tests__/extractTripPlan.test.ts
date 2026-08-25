import { describe, expect, it } from "vitest";
import { buildUserMessage, parseTripPlanResponse } from "../functions/extractTripPlan";
import {
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
  buildUserMessage as vercelBuildUserMessage,
  parseTripPlanResponse as vercelParseTripPlanResponse,
} from "../../api/extractTripPlan";
import { SYSTEM_PROMPT } from "../functions/extractTripPlan";

describe("parseTripPlanResponse", () => {
  it("予約確認から、日付順に並べた日程を取り出す", () => {
    const items = parseTripPlanResponse(
      JSON.stringify({
        items: [
          { date: "2026-09-14", startTime: "19:30", title: "福岡→羽田 JAL330", type: "transport" },
          { date: "2026-09-12", startTime: "08:20", title: "羽田→福岡 JAL301", type: "transport", location: "羽田空港" },
        ],
      }),
    );
    expect(items.map((i) => i.title)).toEqual(["羽田→福岡 JAL301", "福岡→羽田 JAL330"]);
    expect(items[0].location).toBe("羽田空港");
  });

  it("同じ日は時刻の早い順に並べる", () => {
    const items = parseTripPlanResponse(
      JSON.stringify({
        items: [
          { date: "2026-09-12", startTime: "15:00", title: "ホテルにチェックイン", type: "lodging" },
          { date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" },
        ],
      }),
    );
    expect(items.map((i) => i.startTime)).toEqual(["08:20", "15:00"]);
  });

  it("前置きやコードフェンスが付いていても読み取れる", () => {
    // 「JSONだけ返せ」と指示していても付いてくることがある。
    const items = parseTripPlanResponse(
      '承知しました。\n```json\n{"items":[{"date":"2026-09-12","title":"羽田→福岡","type":"transport"}]}\n```',
    );
    expect(items).toHaveLength(1);
  });

  it("日付やタイトルが欠けた項目は捨てる", () => {
    // 日程表に置きようがないものを通すと、一覧の並びが壊れる。
    const items = parseTripPlanResponse(
      JSON.stringify({
        items: [
          { date: "9/12", title: "羽田→福岡", type: "transport" },
          { date: "2026-09-12", title: "", type: "transport" },
          { date: "2026-09-12", title: "羽田→福岡", type: "transport" },
        ],
      }),
    );
    expect(items).toHaveLength(1);
  });

  it("知らない種類は「その他」に寄せる", () => {
    const items = parseTripPlanResponse(
      JSON.stringify({ items: [{ date: "2026-09-12", title: "何か", type: "flight" }] }),
    );
    expect(items[0].type).toBe("other");
  });

  it("時刻の形が違えば、推測せずに省く", () => {
    const items = parseTripPlanResponse(
      JSON.stringify({ items: [{ date: "2026-09-12", startTime: "朝", title: "出発", type: "transport" }] }),
    );
    expect(items[0].startTime).toBeUndefined();
  });

  it("日程が無ければ空で返す", () => {
    expect(parseTripPlanResponse('{"items":[]}')).toEqual([]);
  });

  it("JSONが壊れていても落ちない", () => {
    // 途中で切れた応答をそのまま画面へ流さないための最後の砦。
    expect(parseTripPlanResponse('{"items":[{"date":"2026-09-12"')).toEqual([]);
    expect(parseTripPlanResponse("すみません、分かりませんでした")).toEqual([]);
  });
});

describe("金額の読み取り", () => {
  const parseAmount = (amount: unknown) =>
    parseTripPlanResponse(JSON.stringify({ items: [{ date: "2026-09-19", title: "のぞみ124号", type: "transport", amount }] }))[0]
      ?.amount;

  it("数字はそのまま費用として使う", () => {
    expect(parseAmount(12540)).toBe(12540);
  });

  it("小数は円に丸める", () => {
    expect(parseAmount(12540.4)).toBe(12540);
  });

  it("0・マイナス・数字でないものは捨てる", () => {
    // 読み違えたまま費用に積むと、旅行の予算がずれる。
    expect(parseAmount(0)).toBeUndefined();
    expect(parseAmount(-500)).toBeUndefined();
    expect(parseAmount("12,540円")).toBeUndefined();
    expect(parseAmount(undefined)).toBeUndefined();
  });
});

describe("buildUserMessage", () => {
  it("基準日を渡す(「来月12日」のような書き方を実際の日付に直せるように)", () => {
    expect(buildUserMessage({ today: "2026-08-25", subject: "予約確認", body: "本文" })).toContain("[基準日] 2026-08-25");
  });

  it("長い本文は頭から一定量だけ渡す(規約やフッターでトークンを使い切らないように)", () => {
    const message = buildUserMessage({ body: "あ".repeat(20_000) });
    expect(message.length).toBeLessThan(13_000);
  });
});

describe("Netlify版とVercel版のずれ", () => {
  // 同じ判断を2か所に書いてあるのは、netlify側から読み込む形にすると Vercel の
  // バンドルに含まれず関数ごと落ちるため。片方だけ直して食い違わないよう突き合わせる。
  const cases = [
    JSON.stringify({ items: [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }] }),
    JSON.stringify({ items: [{ date: "2026-09-19", title: "のぞみ124号", type: "transport", amount: 12540 }] }),
    JSON.stringify({ items: [{ date: "2026-09-19", title: "のぞみ124号", type: "transport", amount: "12,540円" }] }),
    '```json\n{"items":[{"date":"2026-09-12","title":"移動","type":"flight"}]}\n```',
    '{"items":[{"date":"9/12","title":"移動"}]}',
    "読み取れませんでした",
    '{"items":[{"date":"2026-09-12"',
  ];

  it("応答の読み取りが、どちらも同じ結果になる", () => {
    for (const text of cases) {
      expect(vercelParseTripPlanResponse(text)).toEqual(parseTripPlanResponse(text));
    }
  });

  it("AIへの指示と、渡す内容の組み立ても同じ", () => {
    expect(VERCEL_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    const payload = { today: "2026-08-25", subject: "予約確認", body: "本文" };
    expect(vercelBuildUserMessage(payload)).toBe(buildUserMessage(payload));
  });
});
