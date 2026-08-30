import { describe, expect, it } from "vitest";
import {
  buildContent,
  buildUserMessage,
  hasNoSource,
  parseTripPlanResponse,
  pickResponseText,
  readImages,
} from "../functions/extractTripPlan";
import {
  SYSTEM_PROMPT as VERCEL_SYSTEM_PROMPT,
  buildContent as vercelBuildContent,
  buildUserMessage as vercelBuildUserMessage,
  hasNoSource as vercelHasNoSource,
  parseTripPlanResponse as vercelParseTripPlanResponse,
  pickResponseText as vercelPickResponseText,
  readImages as vercelReadImages,
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

  it("移動は、出発地と到着地の両方を持てる", () => {
    // ルートに「東京駅 → 新函館北斗駅」として起こすのに要る(src/lib/mailPlanImport.ts)。
    const items = parseTripPlanResponse(
      JSON.stringify({
        items: [
          {
            date: "2026-09-19",
            title: "東京→新函館北斗 はやぶさ13号",
            type: "transport",
            location: "東京駅",
            endLocation: "新函館北斗駅",
          },
        ],
      }),
    );
    expect(items[0].location).toBe("東京駅");
    expect(items[0].endLocation).toBe("新函館北斗駅");
  });

  it("移動以外に付いてきた到着地は落とす", () => {
    // 宿や観光で location と同じ場所が2度並ぶだけになる。
    const items = parseTripPlanResponse(
      JSON.stringify({
        items: [
          { date: "2026-09-19", title: "ホテルにチェックイン", type: "lodging", location: "ホテルOO", endLocation: "ホテルOO" },
        ],
      }),
    );
    expect(items[0].endLocation).toBeUndefined();
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

describe("終了時刻の読み取り", () => {
  const parseTimes = (startTime: unknown, endTime: unknown) =>
    parseTripPlanResponse(
      JSON.stringify({ items: [{ date: "2026-09-19", title: "のぞみ124号", type: "transport", startTime, endTime }] }),
    )[0];

  it("到着時刻をそのまま終了時刻にする", () => {
    expect(parseTimes("10:05", "13:20")).toMatchObject({ startTime: "10:05", endTime: "13:20" });
  });

  it("形が違う終了時刻は、推測せずに省く", () => {
    expect(parseTimes("10:05", "夕方")?.endTime).toBeUndefined();
    expect(parseTimes("10:05", undefined)?.endTime).toBeUndefined();
  });

  it("開始より前の終了時刻は捨てる(読み違い)", () => {
    // 日をまたぐ移動は別の項目に分けるようAIに指示しているので、逆転は読み違い。
    expect(parseTimes("22:00", "06:30")?.endTime).toBeUndefined();
    expect(parseTimes("22:00", "06:30")?.startTime).toBe("22:00");
  });

  it("開始時刻が無くても、終了時刻だけは持てる", () => {
    expect(parseTimes(undefined, "13:20")?.endTime).toBe("13:20");
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

  it("旅行の期間を渡す(「2日目」を実際の日付に直せるように)", () => {
    const message = buildUserMessage({ today: "2026-08-30", text: "2日目 10:00 五稜郭", tripStart: "2026-09-12", tripEnd: "2026-09-14" });
    expect(message).toContain("[旅行の期間] 2026-09-12 〜 2026-09-14");
    expect(message).toContain("[貼り付けられた文章]");
  });

  it("メールでない時は、空の件名欄を作らない", () => {
    // 「[件名] (件名なし)」だけが並ぶと、メールを読み違えたと受け取られかねない。
    expect(buildUserMessage({ today: "2026-08-30", text: "しおり" })).not.toContain("[件名]");
    expect(buildUserMessage({ today: "2026-08-30", subject: "予約確認" })).toContain("[件名] 予約確認");
  });

  it("写真の枚数を伝える", () => {
    const message = buildUserMessage({
      today: "2026-08-30",
      images: [
        { base64: "AAAA", mediaType: "image/jpeg" },
        { base64: "BBBB", mediaType: "image/png" },
      ],
    });
    expect(message).toContain("[写真] 2枚");
  });

  it("長い貼り付け文章も頭から一定量だけ渡す", () => {
    expect(buildUserMessage({ text: "あ".repeat(40_000) }).length).toBeLessThan(21_000);
  });
});

describe("写真の受け取り", () => {
  it("そのまま渡せる写真だけを通す", () => {
    const { images, error } = readImages({ images: [{ base64: "AAAA", mediaType: "image/jpeg" }] });
    expect(error).toBeUndefined();
    expect(images).toEqual([{ base64: "AAAA", mediaType: "image/jpeg" }]);
  });

  it("写真が無い時は空で返す", () => {
    expect(readImages({}).images).toEqual([]);
    expect(readImages({ images: [] }).images).toEqual([]);
  });

  it("駄目な写真が1枚でもあれば、黙って捨てずに理由を返す", () => {
    // 4枚選んだのに3枚ぶんしか読まれていない状態に、本人が気付けないため。
    expect(readImages({ images: [{ base64: "AAAA", mediaType: "image/heic" }] }).error).toContain("対応していない");
    expect(readImages({ images: [{ base64: "", mediaType: "image/jpeg" }] }).error).toContain("読み込めませんでした");
    expect(readImages({ images: [{ base64: "A".repeat(5_000_001), mediaType: "image/jpeg" }] }).error).toContain("大きすぎます");
  });

  it("枚数が上限を超えたら受け取らない", () => {
    const images = Array.from({ length: 5 }, () => ({ base64: "AAAA", mediaType: "image/jpeg" }));
    expect(readImages({ images }).error).toContain("4枚まで");
  });
});

describe("buildContent", () => {
  it("写真を先、文章を後ろに置く", () => {
    const blocks = buildContent({ today: "2026-08-30", text: "しおり", images: [{ base64: "AAAA", mediaType: "image/jpeg" }] });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(blocks[1]).toMatchObject({ type: "text" });
  });

  it("写真が無ければ文章だけを渡す", () => {
    expect(buildContent({ today: "2026-08-30", subject: "予約確認", body: "本文" })).toHaveLength(1);
  });
});

describe("hasNoSource", () => {
  it("読み取るもとが1つも無い時だけ真", () => {
    expect(hasNoSource({}, 0)).toBe(true);
    expect(hasNoSource({ text: "   " }, 0)).toBe(true);
    expect(hasNoSource({}, 1)).toBe(false);
    expect(hasNoSource({ text: "しおり" }, 0)).toBe(false);
    expect(hasNoSource({ subject: "予約確認" }, 0)).toBe(false);
    expect(hasNoSource({ body: "本文" }, 0)).toBe(false);
  });
});

describe("pickResponseText", () => {
  // claude-sonnet-5 は thinking の指定を省くと考えながら答えるので、content の先頭に
  // text を持たない塊が入る。ここを先頭決め打ちで読んでいたせいで、読み取れているのに
  // 「AIから日程を取得できませんでした」になっていた(2026-08-30)。
  const answer = '{"items":[]}';

  it("考えてから答えた応答でも、本文を取り出す", () => {
    expect(
      pickResponseText([
        { type: "thinking", thinking: "…" } as unknown as { type: string; text?: string },
        { type: "text", text: answer },
      ]),
    ).toBe(answer);
  });

  it("先頭が本文のときはそのまま取り出す", () => {
    expect(pickResponseText([{ type: "text", text: answer }])).toBe(answer);
  });

  it("本文が1つも無ければ空", () => {
    expect(pickResponseText([{ type: "thinking" } as unknown as { type: string; text?: string }])).toBe("");
    expect(pickResponseText([])).toBe("");
    expect(pickResponseText(undefined)).toBe("");
  });
});

describe("Netlify版とVercel版のずれ", () => {
  // 同じ判断を2か所に書いてあるのは、netlify側から読み込む形にすると Vercel の
  // バンドルに含まれず関数ごと落ちるため。片方だけ直して食い違わないよう突き合わせる。
  const cases = [
    JSON.stringify({ items: [{ date: "2026-09-12", startTime: "08:20", title: "羽田→福岡", type: "transport" }] }),
    JSON.stringify({ items: [{ date: "2026-09-19", title: "のぞみ124号", type: "transport", amount: 12540 }] }),
    JSON.stringify({
      items: [{ date: "2026-09-19", startTime: "10:05", endTime: "13:20", title: "のぞみ124号", type: "transport" }],
    }),
    JSON.stringify({
      items: [{ date: "2026-09-19", startTime: "22:00", endTime: "06:30", title: "夜行バス", type: "transport" }],
    }),
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

  it("応答から本文を取り出すところも同じ", () => {
    const contents = [
      [{ type: "text", text: '{"items":[]}' }],
      [{ type: "thinking" } as unknown as { type: string; text?: string }, { type: "text", text: '{"items":[]}' }],
      [{ type: "thinking" } as unknown as { type: string; text?: string }],
      [],
    ];
    for (const content of contents) {
      expect(vercelPickResponseText(content)).toBe(pickResponseText(content));
    }
  });

  it("AIへの指示と、渡す内容の組み立ても同じ", () => {
    expect(VERCEL_SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    const payload = { today: "2026-08-25", subject: "予約確認", body: "本文" };
    expect(vercelBuildUserMessage(payload)).toBe(buildUserMessage(payload));
  });

  it("写真の受け取りと、渡す中身の組み立ても同じ", () => {
    const payloads = [
      { today: "2026-08-25", text: "しおり", images: [{ base64: "AAAA", mediaType: "image/jpeg" }] },
      { today: "2026-08-25", images: [{ base64: "AAAA", mediaType: "image/heic" }] },
      { today: "2026-08-25", text: "2日目 10:00 五稜郭", tripStart: "2026-09-12", tripEnd: "2026-09-14" },
    ];
    for (const payload of payloads) {
      expect(vercelReadImages(payload)).toEqual(readImages(payload));
      expect(vercelBuildContent(payload)).toEqual(buildContent(payload));
      expect(vercelHasNoSource(payload, 0)).toBe(hasNoSource(payload, 0));
    }
  });
});
