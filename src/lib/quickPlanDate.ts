/**
 * 「日程・費用・ルートをまとめて追加」(＋)を開いた時の、日付の初期値(2026-10-16、要望
 * 「3日目の予定を増やしているのに2日目のルートが増えるので、きちんと反映されるようにして」)。
 *
 * これまでは「今日(旅行中なら)、そうでなければ1日目」に決め打ちだった。3日目を見ながら＋を押しても2日目(今日)の予定・ルートに
 * なるので、見ている日と違う日に入っていた。「予定を追加」(日程の日の中のボタン)は、前から見ている日に足している。
 *
 *  - ルートのタブでは、ルートで選んでいる日(日にちのチップ)。選んでいない(全部・日付なし)時は、日程で見ている日。
 *  - それ以外のタブでは、日程で見ている日(まだ選んでいなければ、旅行中なら今日・そうでなければ1日目)。
 */
export function quickPlanDefaultDate(input: {
  tab: string;
  /** ルートのタブで選んでいる日。「全部」「日付なし」などで日が決まっていなければ null。 */
  routeDay: string | null;
  dayList: string[];
  /** 日程で見ている日(まだ選んでいなければ既定の日)。 */
  activeScheduleDay: string;
}): string {
  const { tab, routeDay, dayList, activeScheduleDay } = input;
  if (tab === "route" && routeDay && dayList.includes(routeDay)) return routeDay;
  return activeScheduleDay;
}
