import { describe, expect, it } from "vitest";
import { describeTitleDateTime, parseTitleDateTime } from "./titleDateTime";

// テストの中の「今日」。実際の今日を使うと、その日が来ただけで結果が変わってしまう。
const MONDAY = "2026-10-12";
const WEDNESDAY = "2026-10-14";

function parse(title: string, today = MONDAY) {
  return parseTitleDateTime(title, today);
}

describe("parseTitleDateTime — 言葉で書いた日", () => {
  it("今日・明日・明後日", () => {
    expect(parse("今日 歯医者")).toEqual({ date: "2026-10-12", title: "歯医者" });
    expect(parse("本日 歯医者")?.date).toBe("2026-10-12");
    expect(parse("明日 歯医者")?.date).toBe("2026-10-13");
    expect(parse("あした 歯医者")?.date).toBe("2026-10-13");
    expect(parse("明後日 映画")?.date).toBe("2026-10-14");
    expect(parse("あさって 映画")?.date).toBe("2026-10-14");
    expect(parse("しあさって 映画")?.date).toBe("2026-10-15");
  });

  it("月の終わりをまたいでも数えられる", () => {
    expect(parse("明後日 映画", "2026-10-31")?.date).toBe("2026-11-02");
  });
});

describe("parseTitleDateTime — 曜日", () => {
  it("曜日だけなら、今日より後で最初に来るその曜日", () => {
    expect(parse("火曜 歯医者")?.date).toBe("2026-10-13");
    expect(parse("金曜日 歯医者")?.date).toBe("2026-10-16");
    expect(parse("日曜 歯医者")?.date).toBe("2026-10-18");
  });

  it("今日と同じ曜日は、今日ではなく1週間後(今日なら「今日」と書くため)", () => {
    expect(parse("月曜 会議")?.date).toBe("2026-10-19");
    expect(parse("水曜 会議", WEDNESDAY)?.date).toBe("2026-10-21");
  });

  it("「次の」「今度の」も、次に来るその曜日", () => {
    expect(parse("次の水曜日 会議")?.date).toBe("2026-10-14");
    expect(parse("次の月曜 会議")?.date).toBe("2026-10-19");
    expect(parse("今度の土曜 引っ越し")?.date).toBe("2026-10-17");
  });

  it("「来週の」は来週(月曜はじまり)のその曜日", () => {
    expect(parse("来週の火曜 飲み会")?.date).toBe("2026-10-20");
    expect(parse("来週月曜 会議")?.date).toBe("2026-10-19");
    expect(parse("来週の日曜 会議")?.date).toBe("2026-10-25");
    // 水曜に書いた「来週の火曜」は、次に来る火曜(10/20)ではあるが、2週間後ではない。
    expect(parse("来週の火曜 飲み会", WEDNESDAY)?.date).toBe("2026-10-20");
  });

  it("「再来週」「今週」", () => {
    expect(parse("再来週の金曜 旅行")?.date).toBe("2026-10-30");
    expect(parse("今週の金曜 締切")?.date).toBe("2026-10-16");
    expect(parse("今週の日曜 締切")?.date).toBe("2026-10-18");
  });

  it("「毎週月曜」は繰り返しの話なので、日付にしない", () => {
    expect(parse("毎週月曜 ゴミ出し")).toBeNull();
    expect(parse("毎週 月曜 ゴミ出し")).toBeNull();
  });
});

describe("parseTitleDateTime — 数字で書いた日", () => {
  it("M/D と M月D日", () => {
    expect(parse("10/20 面接")).toEqual({ date: "2026-10-20", title: "面接" });
    expect(parse("10月20日 面接")).toEqual({ date: "2026-10-20", title: "面接" });
    expect(parse("10 月 20 日 面接")?.date).toBe("2026-10-20");
  });

  it("年の明けた日付は来年にする", () => {
    expect(parse("1/5 初詣")?.date).toBe("2027-01-05");
    expect(parse("1月5日 初詣")?.date).toBe("2027-01-05");
  });

  it("年まで書いてあればその年", () => {
    expect(parse("2026/11/3 文化祭")?.date).toBe("2026-11-03");
    expect(parse("2027年1月5日 初詣")?.date).toBe("2027-01-05");
  });

  it("後ろの(火)も一緒に取り除く", () => {
    expect(parse("10/20(火) 面接")).toEqual({ date: "2026-10-20", title: "面接" });
    expect(parse("10月20日（火曜） 面接")?.title).toBe("面接");
  });

  it("「20日」だけなら今月、過ぎていれば来月", () => {
    expect(parse("20日 美容院")?.date).toBe("2026-10-20");
    expect(parse("5日 美容院")?.date).toBe("2026-11-05");
    expect(parse("12日 美容院")?.date).toBe("2026-10-12");
  });

  it("長さ・回数・繰り返しの「日」は日付にしない", () => {
    expect(parse("3日間 合宿")).toBeNull();
    expect(parse("2日目 観光")).toBeNull();
    expect(parse("1日1回 薬")).toBeNull();
    expect(parse("毎月25日 家賃")).toBeNull();
  });

  it("ありえない日付は読まない", () => {
    expect(parse("2/30 何か")).toBeNull();
    expect(parse("13/1 何か")).toBeNull();
  });

  it("数字の途中から読まない", () => {
    expect(parse("110/13 何か")).toBeNull();
  });

  it("全角の数字でも読む", () => {
    expect(parse("１０／２０ 面接")?.date).toBe("2026-10-20");
  });
});

describe("parseTitleDateTime — 時刻", () => {
  it("H時・H時半・H時MM分・H:MM", () => {
    expect(parse("19時 歯医者")).toEqual({ startTime: "19:00", title: "歯医者" });
    expect(parse("19時半 歯医者")?.startTime).toBe("19:30");
    expect(parse("7時15分 歯医者")?.startTime).toBe("07:15");
    expect(parse("19:45 歯医者")?.startTime).toBe("19:45");
    expect(parse("9:05 歯医者")?.startTime).toBe("09:05");
  });

  it("午前・午後・朝・夜・夕方", () => {
    expect(parse("午後3時 打ち合わせ")?.startTime).toBe("15:00");
    expect(parse("午前10時 打ち合わせ")?.startTime).toBe("10:00");
    expect(parse("朝9時 打ち合わせ")?.startTime).toBe("09:00");
    expect(parse("夜7時 飲み会")?.startTime).toBe("19:00");
    expect(parse("夕方5時 迎え")?.startTime).toBe("17:00");
    expect(parse("午後2時半 打ち合わせ")?.startTime).toBe("14:30");
    expect(parse("夜 7時 飲み会")?.startTime).toBe("19:00");
  });

  it("「今夜」は夜として読み、タイトルに「今」を残さない", () => {
    expect(parse("今夜8時 飲み")).toEqual({ startTime: "20:00", title: "飲み" });
  });

  it("12時まわり", () => {
    expect(parse("午後12時 ランチ")?.startTime).toBe("12:00");
    expect(parse("午前12時 何か")?.startTime).toBe("00:00");
    expect(parse("正午 ランチ")).toEqual({ startTime: "12:00", title: "ランチ" });
  });

  it("日付をまたぐ真夜中(夜12時・夜1時)は、時刻として読まない", () => {
    expect(parse("夜12時 何か")).toBeNull();
    expect(parse("夜1時 何か")).toBeNull();
  });

  it("何も付かない数字は書かれたまま(3時を15時と決めつけない)", () => {
    expect(parse("3時 打ち合わせ")?.startTime).toBe("03:00");
  });

  it("「1時間」は長さなので時刻にしない", () => {
    expect(parse("1時間 ジョギング")).toBeNull();
  });

  it("ありえない時刻は読まない", () => {
    expect(parse("25時 何か")).toBeNull();
    expect(parse("24:00 何か")).toBeNull();
  });

  it("全角の数字・コロンでも読む", () => {
    expect(parse("明日１９：３０ 歯医者")).toEqual({ date: "2026-10-13", startTime: "19:30", title: "歯医者" });
  });
});

describe("parseTitleDateTime — 開始〜終了", () => {
  it("19時〜21時・19:00-21:00・19時から21時まで", () => {
    expect(parse("明日19時〜21時 飲み会")).toEqual({
      date: "2026-10-13",
      startTime: "19:00",
      endTime: "21:00",
      title: "飲み会",
    });
    expect(parse("19:00-21:00 会議")).toEqual({ startTime: "19:00", endTime: "21:00", title: "会議" });
    expect(parse("19時から21時まで 会議")).toEqual({ startTime: "19:00", endTime: "21:00", title: "会議" });
  });

  it("「19〜21時」のように、開始に「時」が付かない書き方", () => {
    expect(parse("19〜21時 会議")).toEqual({ startTime: "19:00", endTime: "21:00", title: "会議" });
  });

  it("終わりの方は開始の午後・夜を引き継ぐ", () => {
    expect(parse("午後2時〜4時 会議")).toMatchObject({ startTime: "14:00", endTime: "16:00" });
    expect(parse("午後2〜4時 会議")).toMatchObject({ startTime: "14:00", endTime: "16:00" });
    expect(parse("夜7時〜9時 飲み会")).toMatchObject({ startTime: "19:00", endTime: "21:00" });
  });

  it("終わりが開始より前なら、開始だけにする", () => {
    const parsed = parse("21時〜19時 何か");
    expect(parsed?.startTime).toBe("21:00");
    expect(parsed?.endTime).toBeUndefined();
  });
});

describe("parseTitleDateTime — 日付と時刻をあわせて", () => {
  it("明日19時 歯医者", () => {
    expect(parse("明日19時 歯医者")).toEqual({ date: "2026-10-13", startTime: "19:00", title: "歯医者" });
  });

  it("日時がタイトルの後ろにあっても読む", () => {
    expect(parse("歯医者 明日19時")).toEqual({ date: "2026-10-13", startTime: "19:00", title: "歯医者" });
  });

  it("10/20(火) 14:00 面接 @渋谷", () => {
    expect(parse("10/20(火) 14:00 面接 @渋谷")).toEqual({
      date: "2026-10-20",
      startTime: "14:00",
      title: "面接 @渋谷",
    });
  });

  it("来週の火曜 夜7時から 飲み会", () => {
    expect(parse("来週の火曜 夜7時から 飲み会")).toEqual({
      date: "2026-10-20",
      startTime: "19:00",
      title: "飲み会",
    });
  });

  it("日付の数字を時刻として読み直さない", () => {
    expect(parse("10/13 歯医者")).toEqual({ date: "2026-10-13", title: "歯医者" });
  });
});

describe("parseTitleDateTime — 残るタイトル", () => {
  it("つなぎの言葉(の・に・から・は)も一緒に取り除く", () => {
    expect(parse("明日の19時に歯医者")?.title).toBe("歯医者");
    expect(parse("明日から旅行")?.title).toBe("旅行");
    expect(parse("明日は休み")?.title).toBe("休み");
    expect(parse("7時ごろ集合")?.title).toBe("集合");
  });

  it("ひらがなの言葉の頭は削らない(「のみかい」を「みかい」にしない)", () => {
    expect(parse("明日のみかい")?.title).toBe("のみかい");
  });

  it("日時が最後にある時は、手前の「は」も取る", () => {
    expect(parse("歯医者は明日19時")?.title).toBe("歯医者");
  });

  it("文の途中の日時は、前後をそのまま残す", () => {
    expect(parse("母は明日19時に帰る")?.title).toBe("母は 帰る");
  });

  it("かっこの中の日時を取ったら、空のかっこも消す", () => {
    expect(parse("歯医者（明日19時）")?.title).toBe("歯医者");
  });

  it("前後をつなぐ時は空白を1つ挟む", () => {
    expect(parse("歯医者明日19時カバン持参")?.title).toBe("歯医者 カバン持参");
  });

  it("全部が日時なら、残りは空", () => {
    expect(parse("明日19時")).toEqual({ date: "2026-10-13", startTime: "19:00", title: "" });
  });

  it("2つ目の日付はタイトルに残す(どちらかに決めつけない)", () => {
    const parsed = parse("10/20 10/21 面接");
    expect(parsed?.date).toBe("2026-10-20");
    expect(parsed?.title).toBe("10/21 面接");
  });
});

describe("parseTitleDateTime — 読まないもの", () => {
  it("日時が無ければ null", () => {
    expect(parse("歯医者")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("第2回 定例")).toBeNull();
    expect(parse("iPhone15 発売日")).toBeNull();
  });
});

describe("describeTitleDateTime", () => {
  it("日付は M/D(曜)、時刻は頭の0を取る", () => {
    expect(describeTitleDateTime({ date: "2026-10-13", startTime: "19:00", title: "" }, MONDAY)).toBe(
      "10/13(火) 19:00",
    );
    expect(describeTitleDateTime({ startTime: "09:30", title: "" }, MONDAY)).toBe("9:30");
    expect(describeTitleDateTime({ date: "2026-10-13", title: "" }, MONDAY)).toBe("10/13(火)");
  });

  it("終わりまであれば「〜」でつなぐ", () => {
    expect(
      describeTitleDateTime({ date: "2026-10-13", startTime: "19:00", endTime: "21:00", title: "" }, MONDAY),
    ).toBe("10/13(火) 19:00〜21:00");
  });

  it("今年でなければ年を付ける", () => {
    expect(describeTitleDateTime({ date: "2027-01-05", title: "" }, MONDAY)).toBe("2027/1/5(火)");
  });
});
