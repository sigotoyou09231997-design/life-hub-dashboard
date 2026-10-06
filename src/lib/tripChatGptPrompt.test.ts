import { describe, expect, it } from "vitest";
import { EMPTY_PROMPT_PREFS, buildTripPrompt, dayHeading } from "./tripChatGptPrompt";
import { SCAN_CHUNK_CHARS, splitScanText } from "./tripPlanScan";

const trip = {
  name: "四国旅行",
  destination: "高松",
  startDate: "2026-12-27",
  endDate: "2027-01-02",
};

const SEVEN_DAYS = [
  "■2026/12/27(日)",
  "■2026/12/28(月)",
  "■2026/12/29(火)",
  "■2026/12/30(水)",
  "■2026/12/31(木)",
  "■2027/1/1(金)",
  "■2027/1/2(土)",
];

describe("dayHeading", () => {
  it("年と曜日を付けた「■」の見出しにする", () => {
    expect(dayHeading("2026-12-27")).toBe("■2026/12/27(日)");
    // 年をまたぐ旅行で 1/1 がどの年か迷わせない。月・日は0埋めしない。
    expect(dayHeading("2027-01-01")).toBe("■2027/1/1(金)");
  });
});

describe("buildTripPrompt", () => {
  it("旅行の日数ぶんの見出しを、年・曜日つきでこの順に並べさせる", () => {
    const prompt = buildTripPrompt(trip, EMPTY_PROMPT_PREFS);
    const positions = SEVEN_DAYS.map((heading) => prompt.lastIndexOf(`\n${heading}\n`));
    for (const position of positions) expect(position).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(prompt).toContain("次の7つを、この順で全部作る");
  });

  it("旅行の条件(旅行名・行き先・期間・ペース)を入れる", () => {
    const prompt = buildTripPrompt(trip, EMPTY_PROMPT_PREFS);
    expect(prompt).toContain("・旅行名: 四国旅行");
    expect(prompt).toContain("・行き先: 高松");
    expect(prompt).toContain("・期間: 2026/12/27(日)〜2027/1/2(土)(6泊7日)");
    expect(prompt).toContain("・ペース: ふつう(1日あたり 8〜12行ほど)");
  });

  it("入れていない条件は行ごと出さない(空の「出発地:」を渡さない)", () => {
    const prompt = buildTripPrompt({ ...trip, destination: "  " }, EMPTY_PROMPT_PREFS);
    for (const label of ["行き先:", "出発地:", "同行者:", "移動手段:", "予算:", "行きたい所・やりたいこと:", "メモ:"]) {
      expect(prompt, label).not.toContain(label);
    }
    // 出発地が無ければ、現地に着くところから書かせる(行き先までの移動を作らせない)。
    expect(prompt).toContain("現地に着いたところから");
  });

  it("入れた条件を反映する(複数行は1行にまとめる)", () => {
    const prompt = buildTripPrompt(
      { ...trip, budget: 200000, memo: "レンタカーは12/28から" },
      { origin: "小金井", party: "大人2人", transport: "電車", pace: "packed", wishes: "金刀比羅宮\n\n讃岐うどん\n" },
    );
    expect(prompt).toContain("・出発地: 小金井");
    expect(prompt).toContain("・同行者: 大人2人");
    expect(prompt).toContain("・移動手段: 電車");
    expect(prompt).toContain("・ペース: しっかり(1日あたり 12〜16行ほど)");
    expect(prompt).toContain("・予算: 200,000円(旅行全体の目安)");
    expect(prompt).toContain("・行きたい所・やりたいこと: 金刀比羅宮 / 讃岐うどん");
    expect(prompt).toContain("・メモ: レンタカーは12/28から");
    expect(prompt).toContain("出発地に帰り着くところまで");
    expect(prompt).not.toContain("現地に着いたところから");
  });

  it("読み取りが取りこぼす書き方・費用に混ざるものを、書かせない", () => {
    const prompt = buildTripPrompt(trip, EMPTY_PROMPT_PREFS);
    // 金額は、読み取りが旅行の費用として積むので、ChatGPT の見積もりを入れさせない。
    expect(prompt).toContain("料金・金額は書かない");
    // Markdown の飾りと別案・経路図は、日の区切りと予定の抽出を崩す。
    expect(prompt).toContain("Markdown記法");
    expect(prompt).toContain("雨天の別案");
    // 起床・出発のような区切りの行も、時刻付きで入れさせる。
    expect(prompt).toContain("起床・朝食・ホテル出発");
    // 24時を過ぎる予定は、日またぎの判定を読み取りの推測に任せることになる。
    expect(prompt).toContain("24時を過ぎる予定は書かず");
  });

  it("日付が読めない旅行でも依頼文は作れる(見出しの形だけ示す)", () => {
    const prompt = buildTripPrompt({ ...trip, startDate: "", endDate: "" }, EMPTY_PROMPT_PREFS);
    expect(prompt).toContain("形は「■2026/12/27(日) 〇〇→△△」");
    expect(prompt).not.toContain("・期間:");
  });

  it("返事が日ごとに分かれる形を、実際の読み取りの区切りで確かめる", () => {
    // 依頼文が指定する見出し(■年/月/日(曜) 題)と1行1件で返ってきたとき、読み取り側が
    // 1日ぶんを途中で切らずに日ごとに分けられること。見出しの形を変えるときの安全網。
    const lines = (day: number) =>
      Array.from({ length: 12 }, (_, i) => `${String(8 + i).padStart(2, "0")}:00 屋島観光と讃岐うどんの昼食 D${day}-${i}`);
    const reply = SEVEN_DAYS.map((heading, index) => [`${heading} 〇〇→△△`, ...lines(index)].join("\n")).join("\n\n");
    // 分けるほど長い返事であることを先に確かめる(短いだけで1つになったのでは何も試せていない)。
    expect(reply.length).toBeGreaterThan(SCAN_CHUNK_CHARS);

    const chunks = splitScanText(reply);
    expect(chunks.length).toBeGreaterThan(1);
    SEVEN_DAYS.forEach((heading, index) => {
      const owner = chunks.filter((chunk) => chunk.includes(`D${index}-0\n`));
      expect(owner, heading).toHaveLength(1);
      expect(owner[0], heading).toContain(`${heading} 〇〇→△△`);
      // その日の12行が、見出しと同じ回に全部入っている(途中で切れていない)。
      for (let i = 0; i < 12; i++) expect(owner[0], heading).toContain(`D${index}-${i}`);
    });
  });
});
