import { describe, expect, it } from "vitest";
import { summarizeJobApplications } from "./jobStats";
import type { JobApplication, JobApplicationStage } from "../types";

function job(stage: JobApplicationStage, over: Partial<JobApplication> = {}): JobApplication {
  return { companyName: "会社", stage, createdAt: 0, ...over };
}

const TODAY = "2026-09-04";

describe("summarizeJobApplications", () => {
  it("応募が無いときは、割合を出さずに0で返す", () => {
    const stats = summarizeJobApplications([], TODAY);
    expect(stats.total).toBe(0);
    expect(stats.offerRate).toBeNull();
    expect(stats.interviewRate).toBeNull();
    expect(stats.byStage).toHaveLength(8);
  });

  it("段階ごとの件数と、選考中の数を数える", () => {
    const stats = summarizeJobApplications(
      [job("applied"), job("applied"), job("interview1"), job("rejected")],
      TODAY,
    );
    expect(stats.total).toBe(4);
    expect(stats.active).toBe(3);
    expect(stats.byStage.find((s) => s.stage.value === "applied")?.count).toBe(2);
    expect(stats.byStage.find((s) => s.stage.value === "applied")?.ratio).toBe(50);
  });

  it("内定率は、結果が出たぶんだけを分母にする", () => {
    const stats = summarizeJobApplications(
      [job("offer"), job("rejected"), job("declined"), job("interview2")],
      TODAY,
    );
    expect(stats.decided).toBe(3);
    expect(stats.offerRate).toBeCloseTo(33.3);
  });

  it("面接まで進んだ件数は、一次面接以上で結果がまだ出ていないもの", () => {
    const stats = summarizeJobApplications(
      [job("applied"), job("document"), job("interview1"), job("final"), job("offer"), job("rejected")],
      TODAY,
    );
    expect(stats.interviewReached).toBe(3);
    expect(stats.interviewRate).toBe(50);
  });

  it("次の予定を、これからと過ぎたままに分ける", () => {
    const stats = summarizeJobApplications(
      [
        job("interview1", { nextDate: "2026-09-10" }),
        job("interview1", { nextDate: "2026-09-04" }),
        job("document", { nextDate: "2026-08-30" }),
        job("applied"),
      ],
      TODAY,
    );
    expect(stats.upcoming).toBe(2);
    expect(stats.overdue).toBe(1);
  });

  it("知らない段階は応募済みとして数える(記録は書き換えない)", () => {
    const stats = summarizeJobApplications([job("なにか" as JobApplicationStage)], TODAY);
    expect(stats.byStage.find((s) => s.stage.value === "applied")?.count).toBe(1);
  });
});
