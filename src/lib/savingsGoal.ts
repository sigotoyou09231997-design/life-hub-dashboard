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
