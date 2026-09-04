import type { JobApplication } from "../types";
import { JOB_STAGES, getJobStage, isNextDatePast, stageOrder, type JobStageDef } from "./jobApplications";

/** 「面接まで進んだ」と数える最初の段階。 */
const INTERVIEW_FROM = stageOrder("interview1");

export interface JobStageCount {
  stage: JobStageDef;
  count: number;
  /** 応募総数に対する割合(0-100)。棒の長さに使う。 */
  ratio: number;
}

export interface JobApplicationStats {
  total: number;
  /** まだ結果が出ていない件数(応募済み〜内定)。 */
  active: number;
  offers: number;
  rejected: number;
  declined: number;
  /** 結果が出た件数(内定・お見送り・辞退)。 */
  decided: number;
  /** 結果が出たもののうち内定の割合(0-100)。結果がまだ1件も無ければ null。 */
  offerRate: number | null;
  /** いま一次面接以上まで来ている件数。 */
  interviewReached: number;
  /** 応募総数に対する上の割合(0-100)。応募が0件なら null。 */
  interviewRate: number | null;
  /** 段階ごとの件数。0件の段階も並べる(どこで止まっているかを見るため)。 */
  byStage: JobStageCount[];
  /** これから予定がある件数と、日が過ぎたまま段階が変わっていない件数。 */
  upcoming: number;
  overdue: number;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/**
 * 応募先の集計。
 *
 * JobApplication が持つのは「いまの段階」だけで、そこへ至る途中の履歴は残らない。
 * そのため「書類選考の通過率」のような、途中を遡る必要のある数字は出せない
 * (お見送りになった時点で、それまでどこまで進んでいたかが段階から消えるため)。
 * ここで出すのは、いまの段階から数えられるものだけにしてある。
 */
export function summarizeJobApplications(
  applications: JobApplication[],
  today: string,
): JobApplicationStats {
  const total = applications.length;
  const counts = new Map<string, number>();
  let active = 0;
  let interviewReached = 0;
  let upcoming = 0;
  let overdue = 0;

  for (const application of applications) {
    const stage = getJobStage(application.stage);
    counts.set(stage.value, (counts.get(stage.value) ?? 0) + 1);
    if (!stage.closed) active++;
    if (!stage.closed && stageOrder(stage.value) >= INTERVIEW_FROM) interviewReached++;
    if (application.nextDate) {
      if (isNextDatePast(application, today)) overdue++;
      else upcoming++;
    }
  }

  const offers = counts.get("offer") ?? 0;
  const rejected = counts.get("rejected") ?? 0;
  const declined = counts.get("declined") ?? 0;
  const decided = offers + rejected + declined;

  return {
    total,
    active,
    offers,
    rejected,
    declined,
    decided,
    offerRate: decided === 0 ? null : percent(offers, decided),
    interviewReached,
    interviewRate: total === 0 ? null : percent(interviewReached, total),
    byStage: JOB_STAGES.map((stage) => {
      const count = counts.get(stage.value) ?? 0;
      return { stage, count, ratio: percent(count, total) };
    }),
    upcoming,
    overdue,
  };
}
