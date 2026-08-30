import { describe, expect, it } from "vitest";
import type { JobApplication, JobApplicationStage } from "../types";
import {
  getJobStage,
  groupJobApplications,
  isNextDatePast,
  jobEventTitle,
  jobPreparationTask,
  sortJobApplications,
  stageOrder,
} from "./jobApplications";

function application(
  companyName: string,
  over: Partial<JobApplication> = {},
): JobApplication {
  return { id: companyName, companyName, stage: "applied", createdAt: 0, ...over };
}

describe("getJobStage", () => {
  it("段階の表示名を返す", () => {
    expect(getJobStage("interview1").label).toBe("一次面接");
    expect(getJobStage("offer").label).toBe("内定");
  });

  it("知らない段階・未設定は「応募済み」として見せる", () => {
    expect(getJobStage(undefined).value).toBe("applied");
    expect(getJobStage("unknown" as JobApplicationStage).value).toBe("applied");
  });

  it("お見送りと辞退だけが「終わった」扱い", () => {
    expect(getJobStage("rejected").closed).toBe(true);
    expect(getJobStage("declined").closed).toBe(true);
    expect(getJobStage("offer").closed).toBe(false);
  });
});

describe("stageOrder", () => {
  it("応募済みより面接の方が後ろ", () => {
    expect(stageOrder("applied")).toBeLessThan(stageOrder("interview1"));
    expect(stageOrder("interview1")).toBeLessThan(stageOrder("final"));
  });
});

describe("sortJobApplications", () => {
  it("次の予定が近い順に上へ", () => {
    const list = [
      application("あとの会社", { nextDate: "2026-09-10" }),
      application("さきの会社", { nextDate: "2026-09-01" }),
    ];
    expect(sortJobApplications(list).map((a) => a.companyName)).toEqual(["さきの会社", "あとの会社"]);
  });

  it("同じ日なら時刻の早い順", () => {
    const list = [
      application("午後", { nextDate: "2026-09-01", nextTime: "15:00" }),
      application("午前", { nextDate: "2026-09-01", nextTime: "10:00" }),
      application("時刻なし", { nextDate: "2026-09-01" }),
    ];
    expect(sortJobApplications(list).map((a) => a.companyName)).toEqual(["午前", "午後", "時刻なし"]);
  });

  it("次の予定が無いものは、日付があるものより下", () => {
    const list = [application("未定", { stage: "final" }), application("予定あり", { nextDate: "2026-09-01" })];
    expect(sortJobApplications(list).map((a) => a.companyName)).toEqual(["予定あり", "未定"]);
  });

  it("どちらも予定が無ければ、進んでいる段階が上", () => {
    const list = [
      application("応募しただけ", { stage: "applied" }),
      application("最終まで来た", { stage: "final" }),
      application("書類選考中", { stage: "document" }),
    ];
    expect(sortJobApplications(list).map((a) => a.companyName)).toEqual([
      "最終まで来た",
      "書類選考中",
      "応募しただけ",
    ]);
  });

  it("段階まで同じなら、先に登録した順(並びが揺れない)", () => {
    const list = [
      application("あとで登録", { createdAt: 200 }),
      application("先に登録", { createdAt: 100 }),
    ];
    expect(sortJobApplications(list).map((a) => a.companyName)).toEqual(["先に登録", "あとで登録"]);
  });

  it("元の配列は変えない(useLiveQueryの結果をそのまま渡すため)", () => {
    const list = [application("b", { createdAt: 2 }), application("a", { createdAt: 1 })];
    sortJobApplications(list);
    expect(list.map((a) => a.companyName)).toEqual(["b", "a"]);
  });
});

describe("groupJobApplications", () => {
  it("選考中と、終わったものに分ける", () => {
    const list = [
      application("見送り", { stage: "rejected" }),
      application("面接中", { stage: "interview1" }),
      application("辞退した", { stage: "declined" }),
      application("内定", { stage: "offer" }),
    ];
    const groups = groupJobApplications(list);
    // 内定はまだ「終わった」に入れない — 受けるかどうかを決める段階なので手元に残す。
    expect(groups.active.map((a) => a.companyName)).toEqual(["内定", "面接中"]);
    // 終わった側も同じ並び方(予定が無いので段階の後ろの方=辞退が上)。
    expect(groups.closed.map((a) => a.companyName)).toEqual(["辞退した", "見送り"]);
  });

  it("1件も無くても落ちない", () => {
    expect(groupJobApplications([])).toEqual({ active: [], closed: [] });
  });
});

describe("jobEventTitle", () => {
  it("会社名と段階を並べる", () => {
    expect(jobEventTitle(application("ABC株式会社", { stage: "interview2" }))).toBe("ABC株式会社 二次面接");
  });

  it("会社名の前後の空白は落とす", () => {
    expect(jobEventTitle(application("  ABC  ", { stage: "final" }))).toBe("ABC 最終面接");
  });
});

describe("isNextDatePast", () => {
  it("次の予定が過ぎていたら印を出す", () => {
    expect(isNextDatePast(application("A", { nextDate: "2026-08-29" }), "2026-08-30")).toBe(true);
  });

  it("今日と、これからの予定は印を出さない", () => {
    expect(isNextDatePast(application("A", { nextDate: "2026-08-30" }), "2026-08-30")).toBe(false);
    expect(isNextDatePast(application("A", { nextDate: "2026-09-01" }), "2026-08-30")).toBe(false);
  });

  it("予定が無ければ印は出さない", () => {
    expect(isNextDatePast(application("A"), "2026-08-30")).toBe(false);
  });
});

describe("jobPreparationTask", () => {
  it("段階ごとに、やることの分かるタイトルを付ける", () => {
    expect(jobPreparationTask(application("株式会社ABC"))?.title).toBe("株式会社ABC 応募書類を準備する");
    expect(jobPreparationTask(application("ABC", { stage: "interview1" }))?.title).toBe("ABC 一次面接の準備をする");
    expect(jobPreparationTask(application("ABC", { stage: "interview2" }))?.title).toBe("ABC 二次面接の準備をする");
    expect(jobPreparationTask(application("ABC", { stage: "final" }))?.title).toBe("ABC 最終面接の準備をする");
  });

  it("期限は次の予定日の前日にする", () => {
    expect(jobPreparationTask(application("A", { nextDate: "2026-09-10" }))?.dueDate).toBe("2026-09-09");
  });

  it("月初や年をまたぐ前日も出せる", () => {
    expect(jobPreparationTask(application("A", { nextDate: "2026-09-01" }))?.dueDate).toBe("2026-08-31");
    expect(jobPreparationTask(application("A", { nextDate: "2026-01-01" }))?.dueDate).toBe("2025-12-31");
  });

  it("次の予定日が無ければ期限も付けない", () => {
    expect(jobPreparationTask(application("A"))?.dueDate).toBeUndefined();
  });

  it("結果が出た段階と内定では作らない", () => {
    for (const stage of ["offer", "rejected", "declined"] as JobApplicationStage[]) {
      expect(jobPreparationTask(application("A", { stage }))).toBeUndefined();
    }
  });

  it("会社名が空なら作らない", () => {
    expect(jobPreparationTask(application("   "))).toBeUndefined();
  });
});
