import type { JobApplication, JobApplicationStage, SyncedEmail } from "../types";
import { getJobStage, stageOrder } from "./jobApplications";

/**
 * 選考結果のメールを見つけて、就活タブの応募先の段階を進める「提案」を作る。
 *
 * ここでAIは使わない — 予定の提案(src/lib/mailPlanSuggestion.ts)と同じ考え方で、
 * 届いたメールを片っ端からAIに読ませるとAPI呼び出しがそのぶん増えるため、
 * 当たりを付けるところまでは端末の中の文字合わせだけで済ませる。
 * この仕組みではAIを一度も呼ばないので、API呼び出しは1回も増えない。
 *
 * 見ているのは差出人・件名・抜粋(snippet)だけ。本文は端末に持っていない
 * (src/types/index.ts の SyncedEmail)。
 *
 * 提案止まりで、本人が押すまで記録は変えない。
 */

/**
 * 段階を言い当てる手がかり。**上から順に見て、最初に当たったものを採る** —
 * 「一次面接は見送りとさせていただきます」のような文では「見送り」の方を
 * 読みたいので、結果が出る段階を面接の段階より先に置いてある。
 */
const STAGE_KEYWORDS: { stage: JobApplicationStage; words: string[] }[] = [
  {
    stage: "rejected",
    words: [
      "お見送り",
      "見送らせて",
      "見送りとさせて",
      "不採用",
      "ご期待に添え",
      "ご期待に沿え",
      "ご縁がなかった",
      "ご縁がありません",
      "採用を見送",
    ],
  },
  { stage: "offer", words: ["内定", "採用が決定", "採用が決まり", "オファー", "採用のご連絡"] },
  { stage: "final", words: ["最終面接", "最終選考", "役員面接"] },
  { stage: "interview2", words: ["二次面接", "2次面接", "２次面接", "第二次面接", "二次選考"] },
  {
    stage: "interview1",
    words: ["一次面接", "1次面接", "１次面接", "第一次面接", "一次選考", "面接のご案内", "面接の日程", "面接日程"],
  },
  { stage: "document", words: ["書類選考", "書類審査", "応募書類"] },
];

/** 会社名の言い方の揺れ。「株式会社ABC」と「ABC」がメールでは混ざるので、
 * これらを外した名前でも見比べられるようにする。 */
const COMPANY_SUFFIXES = [
  "株式会社",
  "有限会社",
  "合同会社",
  "合資会社",
  "一般社団法人",
  "特定非営利活動法人",
  "(株)",
  "（株）",
  "㈱",
];

/** 1文字の会社名で当ててしまうと、関係ないメールまで拾う。この長さ未満は使わない。 */
const MIN_ALIAS_LENGTH = 2;

function normalize(text: string): string {
  return text.replace(/\s|　/g, "").toLowerCase();
}

/** 会社名から、メールの中で探す言い方を作る。長い順に返す。 */
export function companyAliases(companyName: string): string[] {
  const full = normalize(companyName);
  if (!full) return [];
  let stripped = full;
  for (const suffix of COMPANY_SUFFIXES) {
    stripped = stripped.split(normalize(suffix)).join("");
  }
  const aliases = [full, stripped].filter((alias) => alias.length >= MIN_ALIAS_LENGTH);
  return [...new Set(aliases)].sort((a, b) => b.length - a.length);
}

/** メールの文面に会社名が出てくるか。当たったときは、当たった言い方の長さを返す
 * (どの応募先のメールか迷ったときに、長く一致した方を採るため)。 */
function matchLength(companyName: string, haystack: string): number {
  for (const alias of companyAliases(companyName)) {
    if (haystack.includes(alias)) return alias.length;
  }
  return 0;
}

export function detectStageFromText(text: string): JobApplicationStage | undefined {
  return STAGE_KEYWORDS.find((entry) => entry.words.some((word) => text.includes(word)))?.stage;
}

/** 提案の理由としてそのまま画面に出す言葉。 */
function foundWord(text: string, stage: JobApplicationStage): string | undefined {
  return STAGE_KEYWORDS.find((entry) => entry.stage === stage)?.words.find((word) => text.includes(word));
}

export interface JobStageSuggestion {
  application: JobApplication;
  /** 進める先の段階。 */
  stage: JobApplicationStage;
  /** メールの中で見つかった言葉。「(お見送り)」のように添えて出す。 */
  hint?: string;
}

type SuggestionEmail = Pick<SyncedEmail, "from" | "subject" | "snippet"> & {
  jobStageSuggestionDismissedAt?: number;
};

/**
 * このメールから、どの応募先をどの段階に進める提案を出すか。出さないときは undefined。
 *
 * 出さないのは次の場合:
 * - 本人が「あとで」を押したメール
 * - 会社名がメールのどこにも出てこない
 * - 段階を言い当てる言葉が無い
 * - すでにその段階になっている
 * - いま記録されている段階より**前**に戻る提案(「面接のご案内」だけを見て、
 *   二次面接まで進んでいる応募先を一次面接に戻してしまうのを防ぐ)
 * - すでに結果が出ている応募先(お見送り・辞退)。蒸し返さない
 */
export function detectJobStageSuggestion(
  email: SuggestionEmail,
  applications: JobApplication[],
): JobStageSuggestion | undefined {
  if (email.jobStageSuggestionDismissedAt) return undefined;

  const text = `${email.subject} ${email.snippet}`;
  const stage = detectStageFromText(text);
  if (!stage) return undefined;

  // 会社名は差出人にだけ書かれていることも多いので、探す先に混ぜる。
  const haystack = normalize(`${email.from} ${text}`);
  let best: { application: JobApplication; length: number } | undefined;
  for (const application of applications) {
    if (!application.id) continue;
    if (getJobStage(application.stage).closed) continue;
    const length = matchLength(application.companyName, haystack);
    if (length > 0 && (!best || length > best.length)) best = { application, length };
  }
  if (!best) return undefined;

  const current = best.application.stage;
  if (current === stage) return undefined;
  // 結果が出る段階(お見送り・内定)は、どこからでも進める。それ以外は前に戻さない。
  if (!getJobStage(stage).closed && stage !== "offer" && stageOrder(stage) <= stageOrder(current)) return undefined;

  return { application: best.application, stage, hint: foundWord(text, stage) };
}
