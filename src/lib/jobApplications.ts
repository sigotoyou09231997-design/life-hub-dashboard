import type { JobApplication, JobApplicationStage } from "../types";

export interface JobStageDef {
  value: JobApplicationStage;
  label: string;
  tone: "neutral" | "accent" | "success" | "danger";
  /** 結果が出て、もう先に進まない段階か。一覧を「選考中」と「終わった」に分ける。 */
  closed: boolean;
}

/**
 * 選考の段階。上から順に進んでいく想定で並べる — 一覧の並び替えも
 * この配列の位置を使うので、間に足すときは順番の意味に気を付ける。
 */
export const JOB_STAGES: JobStageDef[] = [
  { value: "applied", label: "応募済み", tone: "neutral", closed: false },
  { value: "document", label: "書類選考", tone: "accent", closed: false },
  { value: "interview1", label: "一次面接", tone: "accent", closed: false },
  { value: "interview2", label: "二次面接", tone: "accent", closed: false },
  { value: "final", label: "最終面接", tone: "accent", closed: false },
  { value: "offer", label: "内定", tone: "success", closed: false },
  { value: "rejected", label: "お見送り", tone: "danger", closed: true },
  { value: "declined", label: "辞退", tone: "neutral", closed: true },
];

/** 知らない段階(手で書き換えたデータなど)は「応募済み」として見せる。
 * 記録の側は書き換えない — getScheduleCategory と同じ扱い方。 */
export function getJobStage(value: JobApplicationStage | undefined): JobStageDef {
  return JOB_STAGES.find((stage) => stage.value === value) ?? JOB_STAGES[0];
}

export function stageOrder(value: JobApplicationStage | undefined): number {
  const index = JOB_STAGES.findIndex((stage) => stage.value === value);
  return index < 0 ? 0 : index;
}

/**
 * 一覧の並び。
 *
 * 次の予定が決まっているものを、その日の近い順に上へ。日付が無いものは
 * その下に、進んでいる段階が上に来るように置く。「次に何があるか」を
 * 最初に答える画面なので、会社名の五十音順より日付が先。
 */
export function sortJobApplications(applications: JobApplication[]): JobApplication[] {
  return [...applications].sort((a, b) => {
    if (a.nextDate && b.nextDate) {
      const byDate = a.nextDate.localeCompare(b.nextDate);
      if (byDate !== 0) return byDate;
      const byTime = (a.nextTime ?? "99:99").localeCompare(b.nextTime ?? "99:99");
      if (byTime !== 0) return byTime;
    } else if (a.nextDate !== b.nextDate) {
      return a.nextDate ? -1 : 1;
    }
    const byStage = stageOrder(b.stage) - stageOrder(a.stage);
    if (byStage !== 0) return byStage;
    return a.createdAt - b.createdAt;
  });
}

export interface JobApplicationGroups {
  /** まだ結果が出ていないもの(応募済み〜内定)。 */
  active: JobApplication[];
  /** お見送り・辞退。数は出すが、下にたたんで置く。 */
  closed: JobApplication[];
}

export function groupJobApplications(applications: JobApplication[]): JobApplicationGroups {
  const sorted = sortJobApplications(applications);
  return {
    active: sorted.filter((application) => !getJobStage(application.stage).closed),
    closed: sorted.filter((application) => getJobStage(application.stage).closed),
  };
}

/**
 * 予定表に入れるときのタイトル。「NNN株式会社 一次面接」のように、
 * カレンダーで見たときに何の予定か分かる形にする。
 */
export function jobEventTitle(application: JobApplication): string {
  return `${application.companyName.trim()} ${getJobStage(application.stage).label}`.trim();
}

/** 次の予定が過ぎているか。過ぎたままの応募先は、段階を進め忘れている可能性が高いので印を出す。 */
export function isNextDatePast(application: JobApplication, today: string): boolean {
  return Boolean(application.nextDate && application.nextDate < today);
}
