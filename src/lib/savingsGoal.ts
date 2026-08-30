import type { SavingsGoal } from "../types";

export interface SavingsGoalProgress {
  /** 設定した毎月の貯金目標額(Settings.savingsGoalMonthly)。 */
  goal: number;
  /** このまま今期を終えたときに貯金へ回せる見込み額。給料日までの残額
   * (usePayPeriodBudgetのremaining)をそのまま使う — 残額計算そのものは変えない。 */
  projected: number;
  /** 目標に対して届いている割合(0-100に丸めた表示用の値)。 */
  ratio: number;
  /** 目標に足りない額。届いている(または超えている)ときは0。 */
  shortfall: number;
  /** 目標を超えて余っている額。届いていないときは0。 */
  surplus: number;
  onTrack: boolean;
}

/**
 * 貯金目標に対して今どこまで来ているかを出す。目標が未設定(0以下)なら null —
 * 呼び出し側はそのとき何も出さない(目標を強制しない、という依頼どおりの扱い)。
 * 残額がマイナスのときの割合は0にする(棒が逆向きに伸びるのを防ぐ)。
 */
export function calculateSavingsGoalProgress(goal: number, remaining: number): SavingsGoalProgress | null {
  if (!Number.isFinite(goal) || goal <= 0) return null;
  const projected = Number.isFinite(remaining) ? remaining : 0;
  const ratio = Math.min(100, Math.max(0, (projected / goal) * 100));
  const diff = projected - goal;
  return {
    goal,
    projected,
    ratio,
    shortfall: diff < 0 ? -diff : 0,
    surplus: diff > 0 ? diff : 0,
    onTrack: diff >= 0,
  };
}

/** 「毎月の目標額」1つだけだった頃の設定を引き継ぐときに付ける名前。 */
export const LEGACY_SAVINGS_GOAL_NAME = "貯金目標";

/**
 * settings.savingsGoalMonthly(貯金目標が1つだけだった頃の置き場)から、
 * 引き継ぐべき目標を1件作る。引き継ぐものが無ければ null。
 *
 * DBの移行(db/schema.ts の v15)と、古いバックアップの復元(lib/backup.ts)の
 * 両方から呼ぶ — 片方だけ直すと、復元したときにだけ目標が消える。
 */
export function legacySavingsGoalFrom(
  settingsRows: { savingsGoalMonthly?: number }[],
  now: number,
): Omit<SavingsGoal, "id"> | null {
  const source = settingsRows.find((row) => Number(row.savingsGoalMonthly) > 0);
  const amount = Math.round(Number(source?.savingsGoalMonthly ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { name: LEGACY_SAVINGS_GOAL_NAME, monthlyAmount: amount, createdAt: now, updatedAt: now };
}

/** 目標を並べる順。追加した順(古いものが上)にする。作成日時が同じときは
 * id で決めて、読むたびに順番が入れ替わらないようにする。 */
export function sortSavingsGoals(goals: SavingsGoal[]): SavingsGoal[] {
  return [...goals].sort((a, b) => a.createdAt - b.createdAt || (a.id ?? "").localeCompare(b.id ?? ""));
}

export interface SavingsGoalAllocation {
  goal: SavingsGoal;
  /** その目標に割り当てられた額(上の目標が埋まった残りから配る)。 */
  allocated: number;
  ratio: number;
  shortfall: number;
  covered: boolean;
}

export interface SavingsGoalPlan {
  /** 目標額の合計。 */
  totalTarget: number;
  /** 今期このまま行ったときに貯金へ回せる見込み額(usePayPeriodBudget の remaining)。 */
  projected: number;
  allocations: SavingsGoalAllocation[];
  /** どの目標にも要らなかった余り。全部埋まったときだけ0より大きい。 */
  leftover: number;
  /** 合計に対する進み具合。1つだけの頃と同じ見せ方をこれで作る。 */
  overall: SavingsGoalProgress;
}

/**
 * 複数の貯金目標に、今期の残額を上から順に割り当てる。
 *
 * 目標ごとに「残額 ÷ その目標」を別々に出すと、目標が2つあって残額が
 * どちらか片方ぶんしか無いときに両方100%と出てしまい、合計と食い違う。
 * 封筒に上から入れていくように、埋まった残りを次へ回す。
 *
 * 目標が1つも無い(または全部0以下)なら null — 呼び出し側はそのとき
 * 何も出さない(貯金を強制しない、という1つだった頃と同じ扱い)。
 */
export function planSavingsGoals(goals: SavingsGoal[], remaining: number): SavingsGoalPlan | null {
  const usable = sortSavingsGoals(goals).filter((goal) => Number.isFinite(goal.monthlyAmount) && goal.monthlyAmount > 0);
  if (usable.length === 0) return null;

  const totalTarget = usable.reduce((sum, goal) => sum + goal.monthlyAmount, 0);
  const projected = Number.isFinite(remaining) ? remaining : 0;

  // 残額がマイナスのときは配るものが無い(棒が逆向きに伸びるのを防ぐ)。
  let pool = Math.max(0, projected);
  const allocations = usable.map((goal) => {
    const allocated = Math.min(pool, goal.monthlyAmount);
    pool -= allocated;
    return {
      goal,
      allocated,
      ratio: Math.min(100, Math.max(0, (allocated / goal.monthlyAmount) * 100)),
      shortfall: goal.monthlyAmount - allocated,
      covered: allocated >= goal.monthlyAmount,
    };
  });

  return {
    totalTarget,
    projected,
    allocations,
    leftover: pool,
    overall: calculateSavingsGoalProgress(totalTarget, projected)!,
  };
}
