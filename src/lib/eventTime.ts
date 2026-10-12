/**
 * 予定の入力画面(src/components/calendar/EventForm.tsx)で使う、時刻の足し算と早押しの候補。
 *
 * 時刻は <input type="time"> と同じ "HH:mm"(24時間・0詰め)で持つ。保存される値も
 * この形なので(CalendarEvent.startTime / endTime)、ここで作る値はそのまま保存してよい。
 */

/** 開始だけ入れた時に、終了へ自動で入れる長さ。予定の長さでいちばん多いのが1時間のため。 */
export const DEFAULT_EVENT_MINUTES = 60;

/** 開始の早押し。朝・昼・夜で、手で打つ回数がいちばん多い時刻を1つずつ。 */
export const START_TIME_CHIPS = ["09:00", "12:00", "19:00"] as const;

/** 長さの早押し。押すと「開始 + この長さ」を終了に入れる。 */
export const DURATION_CHIPS = [
  { minutes: 30, label: "30分" },
  { minutes: 60, label: "1時間" },
  { minutes: 120, label: "2時間" },
] as const;

const MINUTES_PER_DAY = 24 * 60;

/** "HH:mm" を0時からの分にする。形が違う・時刻としてありえない値は undefined。 */
export function clockToMinutes(time: string | undefined): number | undefined {
  const match = time?.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/** 0時からの分を "HH:mm" にする(<input type="time"> に入れられる形)。 */
export function minutesToClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 開始から何分か後の時刻。日付をまたぐ時は undefined を返す。
 *
 * この画面の終了時刻は「開始と同じ日の時刻」で、何日かにまたがる予定は終了日の方で表す
 * (src/lib/eventSpan.ts)。23:30 + 1時間 を "00:30" にすると「始まる前に終わる予定」になり、
 * 23:59 で止めると本人が決めていない終わりの時刻をそれらしく保存してしまう。どちらも
 * カレンダーに嘘が出るので、またぐ時は空のままにして本人に任せる。
 */
export function addMinutesSameDay(time: string, minutes: number): string | undefined {
  const start = clockToMinutes(time);
  if (start === undefined) return undefined;
  const end = start + minutes;
  if (end >= MINUTES_PER_DAY) return undefined;
  return minutesToClock(end);
}

/** 開始から終了までの分。どちらかが無い・終了が開始より前なら undefined。 */
export function minutesBetween(start: string, end: string): number | undefined {
  const from = clockToMinutes(start);
  const to = clockToMinutes(end);
  if (from === undefined || to === undefined || to <= from) return undefined;
  return to - from;
}

/** 画面に出す時刻。"09:00" は「9:00」にする(早押しのボタンや提案の文で、頭の0が読みにくいため)。 */
export function formatClock(time: string): string {
  return time.replace(/^0(\d):/, "$1:");
}
