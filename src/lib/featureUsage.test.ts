import { describe, expect, it } from "vitest";
import {
  USAGE_FEATURES,
  countTimestamps,
  formatShare,
  isDismissedFor,
  monthKey,
  summarizeUsage,
  type UsageCountMap,
  type UsageCounts,
} from "./featureUsage";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 13, 12, 0, 0).getTime();

function c(last30: number, last90: number, ever: number = last90): UsageCounts {
  return { last30, last90, ever };
}

function zeroCounts(): UsageCountMap {
  return Object.fromEntries(USAGE_FEATURES.map((feature) => [feature.id, c(0, 0, 0)]));
}

/** 2026-09-13 に Supabase で数えた実際の数(この機能の依頼のもとになった集計)。載っていない機能は0件。 */
function realCounts(): UsageCountMap {
  return {
    ...zeroCounts(),
    gmailRead: c(149, 149),
    expense: c(0, 82),
    gmailBlock: c(48, 60),
    gmailReply: c(40, 40),
    event: c(18, 18),
    tripRoute: c(5, 5),
    memo: c(5, 5),
    tripSchedule: c(4, 4),
    tripExpense: c(4, 4),
    income: c(0, 3),
    tripPacking: c(2, 2),
    gmailImportant: c(1, 1),
  };
}

describe("countTimestamps", () => {
  it("30日・90日・これまでに分けて数え、時刻の無い行は数えない", () => {
    const counts = countTimestamps([NOW - DAY, NOW - 40 * DAY, NOW - 100 * DAY, undefined, null], NOW);
    expect(counts).toEqual({ last30: 1, last90: 2, ever: 3 });
  });

  it("ちょうど30日前は直近30日に入る", () => {
    expect(countTimestamps([NOW - 30 * DAY], NOW).last30).toBe(1);
  });
});

describe("summarizeUsage", () => {
  it("割合は数えられた機能全体に対して出す", () => {
    const report = summarizeUsage(realCounts());
    expect(report.total30).toBe(276);
    expect(report.total90).toBe(373);
    const read = report.features.find((usage) => usage.feature.id === "gmailRead")!;
    expect(formatShare(read.share30)).toBe("54.0%");
  });

  it("よく使う機能は直近30日の多い順に5つ。同数なら90日、その次は定義の順", () => {
    const report = summarizeUsage(realCounts());
    expect(report.top.map((usage) => usage.feature.id)).toEqual(["gmailRead", "gmailBlock", "gmailReply", "event", "memo"]);
  });

  it("90日では使っていたのに30日でゼロになった機能を、お知らせにする", () => {
    const report = summarizeUsage(realCounts());
    expect(report.alerts.map((alert) => [alert.usage.feature.id, alert.kind])).toEqual([
      ["expense", "stopped"],
      ["income", "stopped"],
    ]);
    expect(report.alerts[0].message).toBe("支出の記録、最近使われていません");
    expect(report.alerts[0].detail).toBe("90日では22.0%使われていました");
  });

  it("一度も使っていない機能は、お知らせにはせず「未使用」に並べる", () => {
    const report = summarizeUsage(realCounts());
    expect(report.unused.filter((item) => item.kind === "never").map((item) => item.usage.feature.id)).toEqual([
      "task",
      "fixedCost",
      "paypay",
      "projectTag",
      "categoryBudget",
      "checklist",
      "shopping",
      "diary",
      "tripCurrency",
    ]);
    expect(report.alerts.some((alert) => alert.usage.feature.id === "task")).toBe(false);
  });

  it("90日以上使っていない機能は「しばらく未使用」で、お知らせにはしない", () => {
    const report = summarizeUsage({ ...zeroCounts(), diary: c(0, 0, 12), event: c(3, 3) });
    expect(report.unused.find((item) => item.usage.feature.id === "diary")?.kind).toBe("idle");
    expect(report.alerts).toEqual([]);
  });

  it("割合も1日あたりの回数も半分以下に落ちた機能を、急減として知らせる", () => {
    const report = summarizeUsage({ ...zeroCounts(), expense: c(2, 40), event: c(20, 60) });
    expect(report.alerts).toHaveLength(1);
    expect(report.alerts[0].kind).toBe("dropped");
    expect(report.alerts[0].usage.feature.id).toBe("expense");
    expect(report.alerts[0].detail).toBe("90日で40.0% → 30日で9.1%");
  });

  it("他の機能が増えて割合だけが下がった機能は、急減にしない", () => {
    // 支出は30日で10回・90日で30回 = ペースは変わっていない。Gmailが増えただけ。
    const report = summarizeUsage({ ...zeroCounts(), expense: c(10, 30), gmailRead: c(200, 200) });
    expect(report.alerts).toEqual([]);
  });

  it("もともとほとんど使っていない機能の増減は、急減にしない", () => {
    const report = summarizeUsage({ ...zeroCounts(), tripPacking: c(1, 2), gmailRead: c(100, 100) });
    expect(report.alerts).toEqual([]);
  });

  it("数えられなかった機能は、割合の計算にも一覧にも入れない", () => {
    const report = summarizeUsage({ ...realCounts(), fixedCost: null });
    expect(report.unavailable.map((feature) => feature.id)).toEqual(["fixedCost"]);
    expect(report.features.some((usage) => usage.feature.id === "fixedCost")).toBe(false);
    expect(report.unused.some((item) => item.usage.feature.id === "fixedCost")).toBe(false);
  });

  it("一言コメント: 1つの機能が半分以上なら触れ、手間のある機能が離れていればその傾向を添える", () => {
    const report = summarizeUsage(realCounts());
    expect(report.comments).toEqual([
      "直近30日に使った回数の54.0%が「Gmailの既読」です。",
      "入力の手間がある機能ほど離れやすく、押すだけで済む機能が残る傾向があります。",
    ]);
  });

  it("一言コメント: 離れた機能が無ければそう書く", () => {
    // どれも半分に届かない(予定 5/12 = 41.7%)ので、1つの機能に偏っている旨のコメントは付かない。
    const report = summarizeUsage({ ...zeroCounts(), event: c(5, 10), memo: c(4, 8), diary: c(3, 6) });
    expect(report.comments).toEqual(["この1か月で、急に使われなくなった機能はありません。"]);
  });

  it("記録がまったく無ければ、何も並べずにそう伝える", () => {
    const report = summarizeUsage(zeroCounts());
    expect(report.top).toEqual([]);
    expect(report.alerts).toEqual([]);
    expect(report.comments).toEqual(["まだ数えられる記録がありません。使ったぶんから自動で数えます。"]);
  });
});

describe("お知らせを閉じた月", () => {
  it("閉じた月のうちは出さず、翌月になったらまた出す", () => {
    expect(monthKey(NOW)).toBe("2026-09");
    expect(isDismissedFor("2026-09", NOW)).toBe(true);
    expect(isDismissedFor("2026-08", NOW)).toBe(false);
    expect(isDismissedFor(null, NOW)).toBe(false);
  });
});
